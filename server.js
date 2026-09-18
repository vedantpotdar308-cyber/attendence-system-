const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || 5000;
const DIR = __dirname;
const DB_FILE = path.join(DIR, 'vedant_database.json');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

let DB = null;
let lastUpdated = Date.now();
let revision = 1;

function initDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && parsed.data) {
        revision = parsed.revision || 1;
        lastUpdated = parsed.lastUpdated || Date.now();
        DB = parsed.data;
      } else if (parsed && parsed.branches) {
        DB = parsed;
      }
    }
  } catch (err) {
    console.error('Error loading database:', err.message);
  }

  if (!DB || !DB.branches) {
    DB = {
      version: 4,
      mainAdminPassword: 'admin123',
      branches: [
        { id: 'b1', name: 'शाखा १ (लातूर)', district: 'लातूर (Latur)', password: 'branch1' },
        { id: 'b2', name: 'शाखा २ (नांदेड)', district: 'नांदेड (Nanded)', password: 'branch2' },
        { id: 'b3', name: 'शाखा ३ (उमरगा)', district: 'उमरगा (Umarga)', password: 'branch3' },
        { id: 'b4', name: 'शाखा ४ (बीड)', district: 'बीड (Beed)', password: 'branch4' },
        { id: 'b5', name: 'शाखा ५ (सोलापूर)', district: 'सोलापूर (Solapur)', password: 'branch5' }
      ],
      employees: [],
      attendance: {},
      advances: [],
      dateChangeApprovals: {},
      dateChangeRequests: [],
      settings: {
        clAllowedPerMonth: 1,
        paidWeeklyOff: true,
        ptEnabled: true
      }
    };
    saveDatabase();
  }

  // Ensure Umarga naming
  if (DB.branches) {
    DB.branches.forEach(b => {
      if (b.name && (b.name.includes('धाराशिव') || b.name.includes('Dharashiv'))) {
        b.name = 'शाखा ३ (उमरगा)';
        b.district = 'उमरगा (Umarga)';
      }
    });
  }
}

function saveDatabase() {
  try {
    const payload = {
      revision,
      lastUpdated,
      data: DB
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving DB:', err.message);
  }
}

initDatabase();

const sseClients = new Set();

function broadcast(payload) {
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.res.write(msg);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

setInterval(() => {
  for (const client of sseClients) {
    try {
      client.res.write(':ping\n\n');
    } catch (e) {
      sseClients.delete(client);
    }
  }
}, 15000);

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

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Client-Id');
}

const server = http.createServer((req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Real-Time Sync API: GET /api/data
  if (pathname === '/api/data' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      revision,
      lastUpdated,
      data: DB
    }));
    return;
  }

  // Real-Time Sync API: GET /api/sync-status
  if (pathname === '/api/sync-status' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: true,
      revision,
      lastUpdated,
      connectedClients: sseClients.size
    }));
    return;
  }

  // Real-Time Sync API: POST /api/data
  if (pathname === '/api/data' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const incomingData = payload.data || payload;
        if (!incomingData || !incomingData.branches) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid data format' }));
          return;
        }

        DB = incomingData;
        revision++;
        lastUpdated = Date.now();
        saveDatabase();

        const clientId = req.headers['x-client-id'] || payload.clientId || '';
        broadcast({
          type: 'SYNC_UPDATE',
          revision,
          lastUpdated,
          senderClientId: clientId,
          data: DB
        });

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          success: true,
          revision,
          lastUpdated
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // Real-Time Server-Sent Events (SSE): GET /api/events
  if (pathname === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', revision, lastUpdated, data: DB })}\n\n`);

    const client = { res, id: Math.random().toString(36).substr(2, 9) };
    sseClients.add(client);

    req.on('close', () => {
      sseClients.delete(client);
    });
    return;
  }

  // Static File Serving
  let reqPath = pathname;
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
  console.log('================================================================');
  console.log('  VEDANT ENTERPRISES — REAL-TIME ATTENDANCE & PAYROLL SERVER');
  console.log('================================================================');
  console.log(`  🏢 Branch App:       http://localhost:${PORT}`);
  console.log(`  🛡️ Central Admin:    http://localhost:${PORT}/admin.html`);
  console.log(`  📱 Mobile / Network: http://${ip}:${PORT}`);
  console.log(`  🔄 Real-Time Sync:   Active (SSE + Automatic Multi-Device Sync)`);
  console.log('================================================================');
  console.log('  Press Ctrl+C to stop the server.');
});
