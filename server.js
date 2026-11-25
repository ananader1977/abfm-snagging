'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, timingSafeEqual } = require('node:crypto');

const username = process.env.SNAGGING_USERNAME || 'abfm-admin';
const password = process.env.SNAGGING_PASSWORD;
if (!password || password.length < 16) {
  throw new Error('Set SNAGGING_PASSWORD to a unique password of at least 16 characters.');
}
const hash = input => createHash('sha256').update(input).digest();
const expected = hash('Basic ' + Buffer.from(username + ':' + password).toString('base64'));
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
  if (!timingSafeEqual(hash(req.headers.authorization || ''), expected)) {
    res.writeHead(401, {'WWW-Authenticate': 'Basic realm="ABFM Snagging", charset="UTF-8"'});
    return res.end('Sign-in required.');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, {Allow: 'GET, HEAD'});
    return res.end();
  }
  const asset = routes.get(req.url.split('?')[0]);
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
