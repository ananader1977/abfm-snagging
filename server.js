'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
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
  res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in | ABFM Snagging</title><link rel="stylesheet" href="/style.css"><main class="sign-in"><article><h1>ABFM Snagging</h1>'+
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
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/brand.js', ['brand.js', 'text/javascript; charset=utf-8']]
]);
const server = http.createServer((req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const pathname = req.url.split('?')[0];
  const token = /(?:^|;\s*)snagging_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  const signedIn = (sessions.get(token) || 0) > Date.now();
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
  if (!signedIn && pathname !== '/style.css') {
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
server.listen(port, host, () => console.log('ABFM Snagging server listening on port ' + server.address().port));
