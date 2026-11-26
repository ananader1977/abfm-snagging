'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const appIcons = require('./pwa-icons');
const {Pool}=require('pg');
const {CentralStorage,StorageError}=require('./central-storage');
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required for centralized storage.');
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:5000,statement_timeout:30000});
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
  for (const [token, expiry] of sessions) if (expiry <= Date.now()) sessions.delete(token);
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
  if (!userMatches || !passwordMatches) return signIn(res, true);
  const token = randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + sessionSeconds * 1000);
  res.writeHead(303, {Location:'/', 'Set-Cookie':sessionCookie(req, token, sessionSeconds)});
  res.end();
}
const routes = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.webmanifest', ['app.webmanifest', 'application/manifest+json; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/brand.js', ['brand.js', 'text/javascript; charset=utf-8']]
]);
function respondJson(res,status,data){
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(data));
}
async function stateApi(req,res,pathname,signedIn){
  if(!signedIn)return respondJson(res,401,{error:'Sign in again to access saved records.'});
  if(req.method==='GET'&&pathname==='/api/state')return respondJson(res,200,await storage.get());
  const mode=pathname==='/api/migration'?'migration':pathname==='/api/state'?'save':null;
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
  return respondJson(res,200,await storage.write(payload.revision,payload.state,username,mode));
}
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const pathname = req.url.split('?')[0];
  const token = /(?:^|;\s*)snagging_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  const signedIn = (sessions.get(token) || 0) > Date.now();
  if(pathname.startsWith('/api/')){
    return stateApi(req,res,pathname,signedIn).catch(error=>{
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
  if (!signedIn && pathname !== '/style.css' && pathname !== '/app.webmanifest') {
    res.writeHead(303, {Location:'/login'});
    return res.end();
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
const port = Number(process.env.PORT || 3000);
storage.initialize().then(()=>{
  server.listen(port,host,()=>console.log('ABFM Snagging server listening on port '+server.address().port));
}).catch(error=>{
  console.error('Unable to initialize PostgreSQL storage',error.code||error.name);
  pool.end().finally(()=>{process.exitCode=1;});
});
