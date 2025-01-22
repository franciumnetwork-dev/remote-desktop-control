const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files for the web interface
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

let clients = {};

// WebSocket connection for handling key-based connections
wss.on('connection', (ws, req) => {
  const urlParts = req.url.split('/');
  if (urlParts[1] === 'key' && urlParts[2]) {
    const key = urlParts[2];
    clients[key] = ws;
    ws.key = key;
    console.log(`Connected to client with key: ${key}`);

    ws.on('message', (message) => {
      try {
        const msg = JSON.parse(message);
        Object.values(clients).forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(msg));
          }
        });
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });

    ws.on('close', () => {
      if (ws.key && clients[ws.key]) {
        delete clients[ws.key];
        console.log(`Disconnected from client with key: ${ws.key}`);
      }
    });
  } else {
    ws.close(1008, 'Invalid key path');
  }
});

app.get('/initialize-socket/:key', (req, res) => {
  const key = req.params.key;
  if (key && !clients[key]) {
    res.send(`WebSocket path initialized for key: ${key}`);
  } else {
    res.status(400).send('WebSocket for this key is already initialized or invalid key.');
  }
});

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
