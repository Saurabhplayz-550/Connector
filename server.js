const http = require('http');
const WebSocket = require('ws');
const crypto = require('crypto');

const RELAY_SECRET = process.env.RELAY_SECRET || "CHANGE_ME";
const PORT = process.env.PORT || 3000;

let deviceSocket = null;
const pending = new Map();

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/mcp')) {
    if (!deviceSocket || deviceSocket.readyState !== WebSocket.OPEN) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Device is offline' }));
      return;
    }
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Device timeout' }));
      }, 20000);
      pending.set(id, { res, timer });
      deviceSocket.send(JSON.stringify({ id, method: req.method, path: '/mcp', headers: req.headers, body }));
    });
    return;
  }
  res.writeHead(200);
  res.end('MCP relay running');
});

const wss = new WebSocket.Server({ server, path: '/device-ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.searchParams.get('secret') !== RELAY_SECRET) {
    ws.close(1008, 'Forbidden');
    return;
  }
  deviceSocket = ws;
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      const entry = pending.get(msg.id);
      if (entry) {
        clearTimeout(entry.timer);
        pending.delete(msg.id);
        entry.res.writeHead(msg.status || 200, { 'Content-Type': 'application/json' });
        entry.res.end(msg.body || '');
      }
    } catch (e) {}
  });
  ws.on('close', () => { if (deviceSocket === ws) deviceSocket = null; });
});

server.listen(PORT, () => console.log('Relay listening on', PORT));
