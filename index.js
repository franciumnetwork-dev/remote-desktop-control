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
  ws.on('message', (message) => {
    try {
      const msg = JSON.parse(message);
      if (msg.key) {
        clients[msg.key] = ws;
        ws.key = msg.key;
        console.log(`Connected to client with key: ${msg.key}`);
      } else if (ws.key && clients[ws.key]) {
        Object.values(clients).forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(msg));
          }
        });
      }
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
});

server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
