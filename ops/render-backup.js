'use strict';

const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const {createReadStream}=require('node:fs');
const {mkdtemp,rm,link,open}=require('node:fs/promises');
const {dirname,join,resolve}=require('node:path');
const {tmpdir}=require('node:os');

const retentionDays=35;
const chunkSize=4*1024*1024;
const schemaSql=`
CREATE TABLE IF NOT EXISTS abfm_backup_snapshot (
  backup_date date PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  sha256 text NOT NULL CHECK (length(sha256)=64),
  byte_count bigint NOT NULL CHECK (byte_count>0),
  chunk_count integer NOT NULL CHECK (chunk_count>0)
);
CREATE TABLE IF NOT EXISTS abfm_backup_chunk (
  backup_date date NOT NULL REFERENCES abfm_backup_snapshot(backup_date) ON DELETE CASCADE,
  chunk_index integer NOT NULL CHECK (chunk_index>=0),
  content bytea NOT NULL,
  PRIMARY KEY(backup_date,chunk_index)
);`;

function required(name){
  const value=process.env[name];
  if(!value)throw Error(name+' must be set in the provider environment.');
  return value;
}
function postgresEnvironment(connection){
  const url=new URL(connection);
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.pathname.slice(1))throw Error('Invalid database configuration.');
  const env={
    PATH:process.env.PATH,
    PGHOST:url.hostname,PGPORT:url.port||'5432',
    PGDATABASE:decodeURIComponent(url.pathname.slice(1)),
    PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),
    PGCONNECT_TIMEOUT:'10',PGAPPNAME:'abfm-backup'
  };
  const ssl=url.searchParams.get('sslmode');
  if(ssl)env.PGSSLMODE=ssl;
  return env;
}
function runCommand(binary,args,env){
  return new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{env,stdio:['ignore','ignore','ignore']});
    child.once('error',()=>reject(Error(binary+' could not start.')));
    child.once('exit',code=>code===0?resolve():reject(Error(binary+' failed. Check private database connectivity and permissions.')));
  });
}
async function collectFileDigest(filename){
  const hash=createHash('sha256');
  let byteCount=0,chunkCount=0;
  for await(const chunk of createReadStream(filename,{highWaterMark:chunkSize})){
    hash.update(chunk);
    byteCount+=chunk.length;
    chunkCount++;
  }
  if(!byteCount)throw Error('The database dump is empty.');
  return {sha256:hash.digest('hex'),byteCount,chunkCount};
}
function readRegionDate(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Dubai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  return ['year','month','day'].map(key=>parts.find(part=>part.type===key).value).join('-');
}
function cutoffDate(date){
  const cutoff=new Date(date+'T00:00:00Z');
  cutoff.setUTCDate(cutoff.getUTCDate()-retentionDays);
  return cutoff.toISOString().slice(0,10);
}
async function transaction(pool,fn){
  const db=await pool.connect();
  try{
    await db.query('BEGIN');
    const result=await fn(db);
    await db.query('COMMIT');
    return result;
  }catch(error){
    await db.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{db.release();}
}
async function saveSnapshot(pool,filename,date,info){
  return transaction(pool,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(91403316)');
    const inserted=await db.query(
      'INSERT INTO abfm_backup_snapshot(backup_date,sha256,byte_count,chunk_count) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
      [date,info.sha256,info.byteCount,info.chunkCount]);
    if(!inserted.rowCount)return false;
    let index=0;
    const copied=createHash('sha256');
    for await(const chunk of createReadStream(filename,{highWaterMark:chunkSize})){
      copied.update(chunk);
      await db.query('INSERT INTO abfm_backup_chunk(backup_date,chunk_index,content) VALUES($1,$2,$3)',[date,index++,chunk]);
    }
    if(index!==info.chunkCount||copied.digest('hex')!==info.sha256)throw Error('The dump changed before backup verification.');
    const {rows:[check]}=await db.query(
      'SELECT count(*)::integer AS chunks, coalesce(sum(octet_length(content)),0)::bigint AS bytes FROM abfm_backup_chunk WHERE backup_date=$1',[date]);
    if(check.chunks!==info.chunkCount||Number(check.bytes)!==info.byteCount)throw Error('Backup chunk verification failed.');
    await db.query('DELETE FROM abfm_backup_snapshot WHERE backup_date < $1',[cutoffDate(date)]);
    return true;
  });
}
async function backup(destination){
  const sourceUrl=required('DATABASE_URL');
  const targetUrl=required('BACKUP_DATABASE_URL');
  const source=postgresEnvironment(sourceUrl), target=postgresEnvironment(targetUrl);
  if(source.PGHOST===target.PGHOST&&source.PGPORT===target.PGPORT&&source.PGDATABASE===target.PGDATABASE){
    throw Error('The backup database must be separate from production.');
  }
  const {Pool}=require('pg');
  const production=new Pool({connectionString:sourceUrl,max:1,connectionTimeoutMillis:10000});
  try{
    const {rows:[row]}=await production.query("SELECT to_regclass('public.snagging_state') AS ready");
    if(!row.ready)throw Error('Production app schema is not ready. No empty backup was written.');
  }finally{await production.end();}
  const date=readRegionDate();
  const existing=await destination.query('SELECT 1 FROM abfm_backup_snapshot WHERE backup_date=$1',[date]);
  if(existing.rowCount){console.log('Verified backup already recorded for '+date);return;}
  const directory=await mkdtemp(join(tmpdir(),'abfm-backup-'));
  const filename=join(directory,'database.dump');
  try{
    await runCommand('pg_dump',['--format=custom','--schema=public','--no-owner','--no-acl','--file',filename],source);
    await runCommand('pg_restore',['--list',filename],source);
    const info=await collectFileDigest(filename);
    const stored=await saveSnapshot(destination,filename,date,info);
    console.log(stored?'Stored and verified '+date+' backup ('+info.byteCount+' bytes).':'Backup already recorded for '+date);
  }finally{await rm(directory,{recursive:true,force:true});}
}

async function exportBackup(pool,date,out){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!out)throw Error('Usage: export YYYY-MM-DD output.dump');
  const path=resolve(out);
  const directory=await mkdtemp(join(dirname(path),'.abfm-restore-'));
  const temp=join(directory,'database.dump');
  try{
    const file=await open(temp,'wx',0o600);
    try{
      await transaction(pool,async db=>{
        const {rows:[snapshot]}=await db.query('SELECT * FROM abfm_backup_snapshot WHERE backup_date=$1 FOR SHARE',[date]);
        if(!snapshot)throw Error('No backup was found for that date.');
        const checksum=createHash('sha256');
        let size=0;
        for(let i=0;i<snapshot.chunk_count;i++){
          const {rows:[chunk]}=await db.query('SELECT content FROM abfm_backup_chunk WHERE backup_date=$1 AND chunk_index=$2',[date,i]);
          if(!chunk)throw Error('A backup chunk is missing.');
          checksum.update(chunk.content);
          size+=chunk.content.length;
          await file.writeFile(chunk.content);
        }
        if(size!==Number(snapshot.byte_count)||checksum.digest('hex')!==snapshot.sha256)throw Error('Backup integrity verification failed.');
      });
      await file.sync();
    }finally{await file.close();}
    await link(temp,path);
    console.log('Verified backup exported.');
  }finally{await rm(directory,{recursive:true,force:true});}
}
async function main(){
  const {Pool}=require('pg');
  const destination=new Pool({connectionString:required('BACKUP_DATABASE_URL'),max:1,connectionTimeoutMillis:10000});
  try{
    const action=process.argv[2]||'backup';
    if(action==='backup'){
      await transaction(destination,async db=>{
        await db.query('SELECT pg_advisory_xact_lock(91403316)');
        await db.query(schemaSql);
      });
      await backup(destination);
    }else if(action==='export'){
      await exportBackup(destination,process.argv[3],process.argv[4]);
    }else if(action==='list'){
      const {rows}=await destination.query('SELECT backup_date::text, byte_count, sha256 FROM abfm_backup_snapshot ORDER BY backup_date DESC');
      console.log(JSON.stringify(rows,null,2));
    }else throw Error('Use backup, list, or export.');
  }finally{await destination.end();}
}
if(require.main===module)main().catch(error=>{
  console.error(error.code?'Backup operation failed ('+error.code+').':error.message);
  process.exitCode=1;
});
module.exports={postgresEnvironment,readRegionDate,cutoffDate,collectFileDigest,saveSnapshot,exportBackup};
