const http = require('http');
const fs = require('fs');
const path = require('path');
const { createRouter } = require('./routes/router');

const PORT = Number(process.env.PORT || 3000);
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const clients = new Set();

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) client.write(payload);
}

const handleApi = createRouter(broadcast);

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);

  if (req.url.startsWith('/api/events')) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.url.startsWith('/api/')) return handleApi(req, res);
  return serveStatic(req, res);
});

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const cleanPath = url.pathname === '/' ? '/pages/index.html' : url.pathname;
  const filePath = path.normalize(path.join(FRONTEND_DIR, cleanPath));

  if (!filePath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    res.end(content);
  });
}

function setSecurityHeaders(res) {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml'
  }[ext] || 'application/octet-stream';
}

server.listen(PORT, () => {
  console.log(`Shiv Furniture Works Mini ERP running at http://localhost:${PORT}`);
});
