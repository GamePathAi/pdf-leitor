// Servidor local simples (sem dependências) para testar o app.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const dir = path.join(__dirname, 'app');
const port = Number(process.env.PORT) || 8080;
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream', '.ttf': 'font/ttf', '.pdf': 'application/pdf',
};

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(dir, path.normalize(p));
  if (!file.startsWith(dir)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, '0.0.0.0', () => {
  console.log(`PDF Leitor rodando em http://localhost:${port}`);
  for (const ifs of Object.values(os.networkInterfaces()))
    for (const i of ifs) if (i.family === 'IPv4' && !i.internal) console.log(`  na rede: http://${i.address}:${port}`);
});
