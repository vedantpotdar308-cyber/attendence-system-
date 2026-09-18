const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 5000;
const DIR = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  const filePath = path.join(DIR, decodeURIComponent(reqPath));

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  const ip = getLocalIp();
  console.log('====================================================');
  console.log('  Vedant Enterprises Attendance App Server Running');
  console.log('====================================================');
  console.log(`  Local Access:      http://localhost:${PORT}`);
  console.log(`  Admin Portal:      http://localhost:${PORT}/admin.html`);
  console.log(`  Mobile / Network:  http://${ip}:${PORT}`);
  console.log('====================================================');
  console.log('  Press Ctrl+C to stop the server.');
});
