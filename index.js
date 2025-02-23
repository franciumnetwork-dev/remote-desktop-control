const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const dgram = require('dgram');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files for the web interface
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Map for connected WebSocket clients by key
const clients = new Map();

// WebSocket connection handling (for control & video forwarding)
wss.on('connection', (ws, req) => {
  const urlParts = req.url.split('/');
  if (urlParts[1] === 'key' && urlParts[2]) {
    const key = urlParts[2];
    if (clients.has(key)) {
      const existingClient = clients.get(key);
      if (existingClient.readyState === WebSocket.OPEN) {
        ws.close(1008, 'Key already in use');
        console.log(`Key already in use: ${key}`);
        return;
      } else {
        clients.delete(key);
        console.log(`Removed stale client for key: ${key}`);
      }
    }
    clients.set(key, ws);
    ws.key = key;
    console.log(`Connected client with key: ${key}`);

    // Health check with ping/pong
    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        clearInterval(interval);
      }
    }, 10000);

    ws.on('pong', () => {
      console.log(`Pong received from client with key: ${ws.key}`);
    });

    // Forward incoming control messages to complementary client
    ws.on('message', (message) => {
      try {
        const msg = JSON.parse(message);
        const normalizedKey = ws.key.endsWith('browser')
          ? ws.key.slice(0, -7)
          : ws.key + 'browser';
        if (clients.has(normalizedKey)) {
          const targetClient = clients.get(normalizedKey);
          if (targetClient.readyState === WebSocket.OPEN) {
            targetClient.send(JSON.stringify(msg));
          }
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });

    ws.on('close', () => {
      if (ws.key && clients.get(ws.key) === ws) {
        clients.delete(ws.key);
        console.log(`Disconnected client with key: ${ws.key}`);
      }
    });

    ws.on('error', (err) => {
      console.error(`Error on client with key ${ws.key}:`, err);
    });
  } else {
    ws.close(1008, 'Invalid key path');
    console.log('Invalid key path.');
  }
});

// UDP server to receive video packets from Python
const udpServer = dgram.createSocket('udp4');
udpServer.on('message', (msg, rinfo) => {
  // Expect header "KEY:<key>;" at beginning of packet
  const headerEnd = msg.indexOf(';');
  if (headerEnd !== -1) {
    const header = msg.slice(0, headerEnd).toString();
    if (header.startsWith("KEY:")) {
      const key = header.slice(4);
      const videoData = msg.slice(headerEnd + 1);
      // Determine the complementary key (for the browser)
      const normalizedKey = key.endsWith('browser') ? key.slice(0, -7) : key + 'browser';
      if (clients.has(normalizedKey)) {
        const targetClient = clients.get(normalizedKey);
        if (targetClient.readyState === WebSocket.OPEN) {
          // Send the video packet (base64 encoded) to the browser
          targetClient.send(JSON.stringify({ videoPacket: videoData.toString('base64') }));
        }
      }
    }
  }
});
udpServer.bind(4000, () => {
  console.log('UDP server listening on port 4000');
});

// Endpoint to initialize WebSocket for a given key
app.get('/initialize-socket/:key', (req, res) => {
  const key = req.params.key;
  if (!key) {
    res.status(400).send('Invalid key.');
    return;
  }
  if (clients.has(key)) {
    res.status(400).send('WebSocket for this key is already initialized.');
    return;
  }
  res.send(`WebSocket path initialized for key: ${key}`);
});

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
