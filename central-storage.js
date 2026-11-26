'use strict';
const {createHash}=require('node:crypto');

const prefix='JAFZADPWDEOL-Q1126-';
const maxAttachment=25*1024*1024;
const empty={cases:[],catalog:null,sequence:1199};

class StorageError extends Error {
  constructor(status,message){super(message);this.status=status;}
}

function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
function sameCase(existing,incoming){
  if(existing.step<7&&incoming.step<7)return canonical({...existing,quotationReference:null})===canonical({...incoming,quotationReference:null});
  return canonical(existing)===canonical(incoming);
}
function validateState(state){
  if(!state||!Array.isArray(state.cases)||!(state.catalog===null||Array.isArray(state.catalog))){
    throw new StorageError(400,'Invalid case or BOQ data.');
  }
  const ids=new Set();
  for(const c of state.cases){
    if(!c||typeof c.id!=='string'||!/^SG-[A-Z0-9-]{1,40}$/i.test(c.id)||ids.has(c.id)||
      !Number.isInteger(c.step)||c.step<0||c.step>11||![c.snags,c.bids,c.history].every(Array.isArray)){
      throw new StorageError(400,'Invalid or repeated case record.');
    }
    ids.add(c.id);
  }
  const refs=new Set();
  for(const row of state.catalog||[]){
    if(!row||typeof row.ref!=='string'||!row.ref.trim()||refs.has(row.ref)||
      typeof row.description!=='string'||!row.description.trim()||typeof row.unit!=='string'||
      ![row.budget,row.rate].every(value=>value===null||(Number.isFinite(value)&&value>=0))){
      throw new StorageError(400,'Invalid or repeated BOQ reference.');
    }
    refs.add(row.ref);
  }
}

function reconcileReferences(state,previous){
  const reserved=new Map();
  let sequence=Math.max(1199,previous.sequence||0);
  function reserve(reference,id) {
    if(!reference)return;
    const key=reference.trim().toUpperCase();
    if(!key)return;
    if(reserved.has(key)&&reserved.get(key)!==id)throw new StorageError(409,'Conflicting quotation reference '+reference+'.');
    reserved.set(key,id);
    const number=key.match(/^JAFZADPWDEOL-Q1126-(\d+)(?:-TENANT)?$/)?.[1];
    if(number&&Number.isSafeInteger(Number(number)))sequence=Math.max(sequence,Number(number));
  }
  const original=new Map(previous.cases.map(c=>[c.id,c]));
  const tasks=new Map();
  for(const c of state.cases){
    const existing=original.get(c.id);
    if(existing?.quotationReference)c.quotationReference=existing.quotationReference;
    if(c.step<7&&!existing)c.quotationReference=null;
    for(const ref of [c.quotationReference,c.quotationDetails?.client?.reference,c.quotationDetails?.tenant?.reference]){
      if(ref!=null&&typeof ref!=='string')throw new StorageError(400,'Invalid quotation reference.');
      reserve(ref,c.id);
    }
    for(const task of [c.inspection,c.reinstatement]){
      if(typeof task!=='string'||!task.trim())continue;
      const key=task.trim().toUpperCase();
      if(tasks.has(key)&&tasks.get(key)!==c.id)throw new StorageError(409,'CAFM Task ID is already linked to another case: '+task);
      tasks.set(key,c.id);
    }
  }
  for(const c of state.cases){
    if(!c.quotationReference&&c.step<7){
      c.quotationReference=prefix+(++sequence);
      reserve(c.quotationReference,c.id);
    }
  }
  return {...state,sequence};
}

function storeAttachments(value,files){
  if(Array.isArray(value))return value.map(item=>storeAttachments(item,files));
  if(value&&typeof value==='object'){
    if(Object.hasOwn(value,'$snaggingAttachment'))throw new StorageError(400,'Invalid attachment reference.');
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,storeAttachments(item,files)]));
  }
  if(typeof value!=='string'||!value.startsWith('data:'))return value;
  const match=value.match(/^data:(image\/(?:jpeg|png|webp)|application\/pdf|application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet);base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match)throw new StorageError(400,'Unsupported attachment encoding.');
  const bytes=Buffer.from(match[2],'base64');
  if(!bytes.length||bytes.length>maxAttachment)throw new StorageError(413,'Attachment exceeds the storage limit.');
  const digest=createHash('sha256').update(match[1]).update('\0').update(bytes).digest('hex');
  files.set(digest,{mime:match[1],bytes});
  return {$snaggingAttachment:digest};
}

function attachmentIds(value,ids=new Set()){
  if(value&&typeof value==='object'){
    if(value.$snaggingAttachment)ids.add(value.$snaggingAttachment);
    else for(const item of Object.values(value))attachmentIds(item,ids);
  }
  return ids;
}
function restoreAttachments(value,files){
  if(Array.isArray(value))return value.map(item=>restoreAttachments(item,files));
  if(!value||typeof value!=='object')return value;
  if(value.$snaggingAttachment){
    const uri=files.get(value.$snaggingAttachment);
    if(!uri)throw new Error('A stored attachment is missing.');
    return uri;
  }
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,restoreAttachments(item,files)]));
}

async function withTransaction(pool,work){
  const connection=await pool.connect();
  try{
    await connection.query('BEGIN');
    const result=await work(connection);
    await connection.query('COMMIT');
    return result;
  }catch(error){
    await connection.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{connection.release();}
}

async function hydrate(connection,document){
  const ids=[...attachmentIds(document)];
  if(!ids.length)return document;
  const {rows}=await connection.query('SELECT digest, mime, content FROM snagging_attachment WHERE digest = ANY($1::text[])',[ids]);
  return restoreAttachments(document,new Map(rows.map(row=>[row.digest,'data:'+row.mime+';base64,'+row.content.toString('base64')])));
}

const setupSql = `
CREATE TABLE IF NOT EXISTS snagging_user (
  username text PRIMARY KEY,
  password_digest text NOT NULL,
  role text NOT NULL CHECK (role IN ('abfm','rahati','client')),
  supplier text,
  properties jsonb NOT NULL DEFAULT '[]'::jsonb,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS snagging_security_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor text NOT NULL,
  target_user text NOT NULL,
  action text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS snagging_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  document jsonb NOT NULL DEFAULT '{"cases":[],"catalog":null,"sequence":1199}'::jsonb
);
INSERT INTO snagging_state (singleton) VALUES (true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS snagging_attachment (
  digest text PRIMARY KEY,
  mime text NOT NULL,
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS snagging_audit (
  revision bigint PRIMARY KEY,
  actor text NOT NULL,
  action text NOT NULL,
  changes jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
`;
class CentralStorage {
  constructor(pool){this.pool=pool;}
  async initialize(){await withTransaction(this.pool,async db=>{
    await db.query('SELECT pg_advisory_xact_lock(73374021)');
    await db.query(setupSql);
  });}
  async get(){
    const {rows:[row]}=await this.pool.query('SELECT revision, document FROM snagging_state WHERE singleton');
    return {revision:Number(row.revision),state:await hydrate(this.pool,row.document)};
  }
  async write(expected,incoming,actor,mode){
    if(!Number.isSafeInteger(expected)||expected<0)throw new StorageError(400,'A valid revision is required.');
    validateState(incoming);
    return withTransaction(this.pool,async db=>{
      const {rows:[row]}=await db.query('SELECT revision, document FROM snagging_state WHERE singleton FOR UPDATE');
      if(Number(row.revision)!==expected)throw new StorageError(409,'Another device saved changes. Reload the live records, then retry.');
      const current=row.document||empty;
      const attachments=new Map();
      const packed=storeAttachments(incoming,attachments);
      let candidate;
      if(mode==='migration'){
        const existing=new Map(current.cases.map(c=>[c.id,c]));
        const conflicts=packed.cases.filter(c=>existing.has(c.id)&&!sameCase(existing.get(c.id),c));
        if(conflicts.length)throw new StorageError(409,'Server and browser copies differ for '+conflicts.map(c=>c.id).join(', ')+'. Local data remains intact.');
        if(current.catalog&&packed.catalog&&canonical(current.catalog)!==canonical(packed.catalog)){
          throw new StorageError(409,'The server already holds a different BOQ. No data was changed.');
        }
        candidate={cases:[...current.cases,...packed.cases.filter(c=>!existing.has(c.id))],catalog:current.catalog??packed.catalog};
      }else{
        const incomingIds=new Set(packed.cases.map(c=>c.id));
        if(current.cases.some(c=>!incomingIds.has(c.id))||current.catalog&&!packed.catalog){
          throw new StorageError(409,'This save would remove existing production data.');
        }
        candidate={cases:packed.cases,catalog:packed.catalog};
      }
      const updated=reconcileReferences(candidate,current);
      const ids=attachmentIds(updated);
      for(const [digest,file] of attachments){
        if(ids.has(digest))await db.query('INSERT INTO snagging_attachment(digest,mime,content) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[digest,file.mime,file.bytes]);
      }
      const prior=new Map(current.cases.map(c=>[c.id,canonical(c)]));
      const changed=updated.cases.filter(c=>prior.get(c.id)!==canonical(c)).map(c=>c.id);
      const catalogChanged=canonical(current.catalog)!==canonical(updated.catalog);
      if(!changed.length&&!catalogChanged)return {revision:expected,state:await hydrate(db,current)};
      const revision=expected+1;
      await db.query('UPDATE snagging_state SET revision=$1, document=$2::jsonb WHERE singleton',[revision,JSON.stringify(updated)]);
      await db.query('INSERT INTO snagging_audit(revision,actor,action,changes) VALUES($1,$2,$3,$4::jsonb)',[revision,actor,mode,JSON.stringify({caseIds:changed,catalogChanged})]);
      return {revision,state:await hydrate(db,updated)};
    });
  }
}

module.exports={CentralStorage,StorageError,validateState,reconcileReferences,storeAttachments,restoreAttachments};
