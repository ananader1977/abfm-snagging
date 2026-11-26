'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const appIcons = require('./pwa-icons');
const {Pool}=require('pg');
const {CentralStorage,StorageError}=require('./central-storage');
const {assignedRecords,passwordDigest,verifyPassword}=require('./central-accounts');
const {applySupplierAction,supplierNoticeTarget}=require('./supplier-workflow');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required for centralized storage.');
const staging=process.env.SNAGGING_STAGE==='true';
const testSchema=process.env.SNAGGING_TEST_SCHEMA;
if(testSchema&&(!staging||!/^snagging_test_[a-f0-9]{16}$/.test(testSchema)))throw new Error('Invalid isolated staging schema.');
const schema=testSchema||'snagging_stage';
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:5000,statement_timeout:30000,
  ...(staging?{options:'-c search_path='+schema}:{})});
const storage=new CentralStorage(pool);
const { createHash, randomBytes, timingSafeEqual } = require('node:crypto');

const username = process.env.SNAGGING_USERNAME || 'abfm-admin';
const password = process.env.SNAGGING_PASSWORD;
if (!password || password.length < 16) {
  throw new Error('Set SNAGGING_PASSWORD to a unique password of at least 16 characters.');
}
const hash = input => createHash('sha256').update(input).digest();
const expectedUser = hash(username);
const expectedPassword = hash(password);
const sessions = new Map();
const sessionSeconds = 8 * 60 * 60;
const cleanup = setInterval(() => {
  for (const [token, session] of sessions) if (session.expiry <= Date.now()) sessions.delete(token);
}, 60_000);
cleanup.unref();

function sessionCookie(req, token, maxAge) {
  const secure = req.socket.encrypted || process.env.RENDER === 'true';
  return 'snagging_session=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + maxAge + (secure ? '; Secure' : '');
}

function signIn(res, invalid = false) {
  res.writeHead(invalid ? 401 : 200, {'Content-Type':'text/html; charset=utf-8'});
  res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in | ABFM Snagging</title><meta name="theme-color" content="#313342"><link rel="manifest" href="/app.webmanifest"><link rel="apple-touch-icon" href="/app-icon-192.png"><link rel="icon" href="/app-icon-192.png"><link rel="stylesheet" href="/style.css"><main class="sign-in"><article><h1>ABFM Snagging</h1>'+
    (invalid ? '<p class="error" role="alert">Incorrect username or password.</p>' : '')+
    '<form method="post" action="/login"><label>Username<input name="username" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button>Sign in</button></form></article></main></html>');
}

async function login(req, res) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) {
      res.writeHead(413);
      res.end('Sign-in request is too large.');
      return;
    }
    chunks.push(chunk);
  }
  const form = new URLSearchParams(Buffer.concat(chunks).toString());
  const userMatches = timingSafeEqual(hash(form.get('username') || ''), expectedUser);
  const passwordMatches = timingSafeEqual(hash(form.get('password') || ''), expectedPassword);
  let identity;
  if(userMatches){
    if(!passwordMatches)return signIn(res,true);
    identity={username,role:'abfm',legacy:true};
  }else{
    const {rows:[account]}=await pool.query('SELECT username,role,password_digest FROM snagging_user WHERE username=$1 AND enabled',[form.get('username')]);
    if(!account||account.role==='client'||!await verifyPassword(form.get('password')||'',account.password_digest))return signIn(res,true);
    identity={username:account.username,role:account.role,legacy:false};
  }
  const token = randomBytes(32).toString('hex');
  sessions.set(token,{...identity,expiry:Date.now()+sessionSeconds*1000});
  res.writeHead(303, {Location:'/', 'Set-Cookie':sessionCookie(req, token, sessionSeconds)});
  res.end();
}
const routes = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.webmanifest', ['app.webmanifest', 'application/manifest+json; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/brand.js', ['brand.js', 'text/javascript; charset=utf-8']],
  ['/supplier', ['supplier.html','text/html; charset=utf-8']],
  ['/supplier.js', ['supplier.js','text/javascript; charset=utf-8']],
  ['/operations', ['operations.html','text/html; charset=utf-8']],
  ['/operations.js', ['operations.js','text/javascript; charset=utf-8']]
]);
function respondJson(res,status,data){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(data));
}
async function stateApi(req,res,pathname,session){
  if(!session)return respondJson(res,401,{error:'Sign in again to access saved records.'});
  let identity=session;
  if(!session.legacy){
    const {rows:[account]}=await pool.query('SELECT username,role,supplier,properties FROM snagging_user WHERE username=$1 AND enabled',[session.username]);
    if(!account||account.role==='client')return respondJson(res,403,{error:'This account is disabled.'});
    identity=account;
  }
  if(req.method==='GET'&&pathname==='/api/assigned'){
    if(identity.role==='abfm')return respondJson(res,403,{error:'Use the ABFM case workspace.'});
    const {revision,state}=await storage.get();
    const records=assignedRecords(state,identity).map(record=>({
      ...record,...(record.stage==='quotation'?{targetBudget:supplierNoticeTarget(state.cases.find(c=>c.id===record.id))}:{})
    }));
    return respondJson(res,200,{revision,records});
  }
  const supplierWrite=pathname==='/api/supplier-action'&&req.method==='PUT';
  const operationsWrite=pathname==='/api/operations-action'&&req.method==='PUT';
  if(identity.role==='operations'){
    if(req.method==='GET'&&pathname==='/api/state')return respondJson(res,200,await storage.get());
    if(!operationsWrite)return respondJson(res,403,{error:'Operations access is limited to editing a Rahati quotation during CS approval.'});
  }else if(identity.role!=='abfm'&&(!supplierWrite||identity.role!=='rahati'))return respondJson(res,403,{error:'This operation requires an ABFM account.'});
  if(req.method==='GET'&&pathname==='/api/state')return respondJson(res,200,await storage.get());
  if(req.method==='GET'&&pathname==='/api/export'){
    res.setHeader('Content-Disposition','attachment; filename="abfm-snagging-data.json"');
    return respondJson(res,200,await storage.get());
  }
  const mode=pathname==='/api/migration'?'migration':pathname==='/api/state'?'save':supplierWrite?'supplier':operationsWrite?'operations':pathname==='/api/rahati-account'?'account':pathname==='/api/operations-account'?'operations-account':null;
  if(!mode||req.method!=='PUT')return respondJson(res,404,{error:'Unknown storage operation.'});
  if(['cross-site','same-site'].includes(req.headers['sec-fetch-site'])||
    req.headers['content-type']?.split(';')[0].trim()!=='application/json'){
    return respondJson(res,403,{error:'Submit the request from the signed-in application.'});
  }
  let length=0;
  const chunks=[];
  for await (const chunk of req){
    length+=chunk.length;
    if(length>32*1024*1024){respondJson(res,413,{error:'This batch is too large. Import fewer records at a time.'});return;}
    chunks.push(chunk);
  }
  let payload;
  try{payload=JSON.parse(Buffer.concat(chunks).toString());}
  catch{return respondJson(res,400,{error:'Invalid save payload.'});}
  if(!payload||typeof payload!=='object')return respondJson(res,400,{error:'Invalid save payload.'});
  if(mode==='account'||mode==='operations-account'){
    if(identity.role!=='abfm')return respondJson(res,403,{error:'Only ABFM can configure user accounts.'});
    if(typeof payload.password!=='string'||payload.password.length<16||payload.password.length>256)return respondJson(res,400,{error:'Use a unique password of 16 to 256 characters.'});
    const isOperations=mode==='operations-account';
    const account=isOperations?'operations':'rahati-bayti';
    const role=isOperations?'operations':'rahati';
    const supplier=isOperations?null:'Rahati Bayti';
    if(username===account)return respondJson(res,409,{error:'The account username cannot be the same as the ABFM username.'});
    const digest=await passwordDigest(payload.password);
    const result=await pool.query(`
      WITH change AS (
        INSERT INTO snagging_user(username,password_digest,role,supplier) VALUES($1,$2,$4,$5)
        ON CONFLICT(username) DO UPDATE SET password_digest=EXCLUDED.password_digest, enabled=true
        WHERE snagging_user.role=$4 RETURNING username
      )
      INSERT INTO snagging_security_audit(actor,target_user,action)
      SELECT $3,username,$6 FROM change
    `,[account,digest,identity.username,role,supplier,isOperations?'Operations account password configured':'Rahati account password configured']);
    if(!result.rowCount)return respondJson(res,409,{error:'That username is assigned to another role.'});
    for(const [key,value] of sessions)if(value.username===account)sessions.delete(key);
    return respondJson(res,200,{username:account});
  }
  if(operationsWrite){
    if(identity.role!=='operations')return respondJson(res,403,{error:'Only the operations account can edit a quotation.'});
    if(!Number.isSafeInteger(payload.revision)||!Number.isInteger(payload.bidIndex)||!Array.isArray(payload.rates))return respondJson(res,400,{error:'The quotation edit is incomplete.'});
    const {revision,state}=await storage.get();
    if(revision!==payload.revision)return respondJson(res,409,{error:'The case changed on another device. Reload before editing.'});
    const record=state.cases.find(c=>c.id===payload.caseId);
    if(!record)return respondJson(res,404,{error:'Case not found.'});
    if(record.step!==5)return respondJson(res,403,{error:'Rahati quotations can only be edited after they are sent to CS approval.'});
    const bid=record.bids[payload.bidIndex];
    if(!bid||bid.supplier!=='Rahati Bayti'||record.award!=='Rahati Bayti'||record.awardedBid!==payload.bidIndex)return respondJson(res,403,{error:'Only the selected Rahati quotation can be edited during CS approval.'});
    if(payload.rates.length!==record.snags.length||payload.rates.some(rate=>!Number.isFinite(rate)||rate<0||rate>1e8||Math.round(rate*100)/100!==rate))return respondJson(res,400,{error:'Enter a valid rate for each BOQ line.'});
    const cents=value=>Math.round(value*100);
    const vendorTotal=record.snags.reduce((sum,line)=>sum+cents(line.budget*line.qty),0);
    const sellingTotal=record.snags.reduce((sum,line)=>sum+cents(line.rate*line.qty),0);
    const lineRatesExceed=record.snags.every((line,index)=>cents(line.rate)>cents(payload.rates[index]));
    if(!(vendorTotal>0&&BigInt(sellingTotal)*100n>=BigInt(vendorTotal)*121n)&&!lineRatesExceed)return respondJson(res,400,{error:'The edit would violate the existing quotation pricing rule.'});
    bid.rates=payload.rates;
    bid.total=record.snags.reduce((sum,line,index)=>sum+Math.round(line.qty*payload.rates[index]*100),0)/100;
    record.history.unshift({event:'Operations updated Rahati quotation during CS approval',time:new Date().toISOString()});
    return respondJson(res,200,await storage.write(revision,state,identity.username,'operations'));
  }
  if(mode==='supplier'){
    if(identity.role!=='rahati')return respondJson(res,403,{error:'Only the assigned supplier can submit this action.'});
    const {revision,state}=await storage.get();
    if(revision!==payload.revision)return respondJson(res,409,{error:'The case changed on another device. Reload before submitting.'});
    const record=state.cases.find(c=>c.id===payload.caseId);
    if(!record)return respondJson(res,404,{error:'Assigned case not found.'});
    applySupplierAction(record,identity,payload);
    await storage.write(revision,state,identity.username,mode);
    return respondJson(res,200,{saved:true});
  }
  return respondJson(res,200,await storage.write(payload.revision,payload.state,identity.username,mode));
}
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const pathname = req.url.split('?')[0];
  const token = /(?:^|;\s*)snagging_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  const storedSession=sessions.get(token);
  const session=storedSession?.expiry>Date.now()?storedSession:null;
  if(pathname.startsWith('/api/')){
    return stateApi(req,res,pathname,session).catch(error=>{
      if(error instanceof StorageError)return respondJson(res,error.status,{error:error.message});
      console.error('Central storage operation failed',error.code||error.name);
      return respondJson(res,503,{error:'The server could not save or load the records. Your change was not confirmed. Please retry.'});
    });
  }
  if (req.method === 'POST' && (pathname === '/login' || pathname === '/logout')) {
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      res.writeHead(403);
      return res.end();
    }
    if (pathname === '/login') return login(req, res).catch(() => res.destroy());
    sessions.delete(token);
    res.writeHead(303, {Location:'/login', 'Set-Cookie':sessionCookie(req, '', 0)});
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, {Allow: 'GET, HEAD'});
    return res.end();
  }
  if (pathname === '/login') return signIn(res);
  const icon=appIcons.get(pathname);
  if(icon){
    res.writeHead(200,{'Content-Type':'image/png'});
    return res.end(req.method==='HEAD'?undefined:icon);
  }
  if (!session && pathname !== '/style.css' && pathname !== '/app.webmanifest') {
    res.writeHead(303, {Location:'/login'});
    return res.end();
  }
  if(session?.role==='operations'){
    if(pathname==='/'||pathname==='/index.html'){
      res.writeHead(303,{Location:'/operations'});
      return res.end();
    }
    if(!['/operations','/operations.js','/style.css','/app.webmanifest'].includes(pathname)){
      res.writeHead(403);
      return res.end('This page is restricted to the operations account.');
    }
  }else if(session&&session.role!=='abfm'){
    if(pathname==='/'||pathname==='/index.html'){
      res.writeHead(303,{Location:'/supplier'});
      return res.end();
    }
    if(!['/supplier','/supplier.js','/app.js','/brand.js','/style.css','/app.webmanifest'].includes(pathname)){
      res.writeHead(403);
      return res.end('This page is restricted to ABFM accounts.');
    }
  }
  const asset = routes.get(pathname);
  if (!asset) {
    res.writeHead(404);
    return res.end('Not found.');
  }
  const [filename, type] = asset;
  fs.readFile(path.join(__dirname, 'public', filename), (error, data) => {
    if (error) {
      res.writeHead(500);
      return res.end('Unable to load application asset.');
    }
    res.writeHead(200, {'Content-Type': type});
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT ?? 3000);
(async()=>{
  if(staging)await pool.query('CREATE SCHEMA IF NOT EXISTS '+schema);
  await storage.initialize();
})().then(()=>{
  server.listen(port,host,()=>console.log('ABFM Snagging server listening on port '+server.address().port));
}).catch(error=>{
  console.error('Unable to initialize PostgreSQL storage',error.code||error.name);
  pool.end().finally(()=>{process.exitCode=1;});
});
