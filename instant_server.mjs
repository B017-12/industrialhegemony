/**
 * Zero-Install Instant HTTP Server for Valmet SpatialSense
 * Works immediately with raw node.exe by serving standalone.html + public assets & CV data
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5173;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.jsx': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream',
  '.ply': 'application/octet-stream',
  '.spz': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pgm': 'application/octet-stream'
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath;
  if (urlPath === '/' || urlPath === '/index.html') {
    filePath = path.join(__dirname, 'standalone.html');
  } else if (urlPath.startsWith('/assets/') || urlPath.startsWith('/data/')) {
    filePath = path.join(__dirname, 'public', urlPath);
  } else {
    filePath = path.join(__dirname, urlPath);
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found: ' + urlPath);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n=============================================================`);
  console.log(`  Valmet SpatialSense 3DGS + CV Prototype is LIVE!`);
  console.log(`  Open in browser: http://localhost:${PORT}`);
  console.log(`=============================================================\n`);
});
