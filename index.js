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

let clients = {}; // Store connected WebSocket clients by key

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  const urlParts = req.url.split('/');
  
  if (urlParts[1] === 'key' && urlParts[2]) {
    const key = urlParts[2];
    if (clients[key]) {
      ws.close(1008, 'Key already in use');
      console.log("Key was in use.");
      return;
    }
    
    clients[key] = ws;
    ws.key = key;
    console.log(`Connected to client with key: ${key}`);
  const interval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping(); // Send a ping frame
    }
  }, 1000); // Every 1 second

  ws.on('pong', () => {
    console.log(`Pong received from client with key: ${ws.key}`);
  });
    ws.on('message', (message) => {
      try {
        const msg = JSON.parse(message);
        // Broadcast the message to all clients except the sender
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
    console.log("It was an invalid key path.");
  }
});

// Endpoint to initialize the WebSocket path for a given key
app.get('/initialize-socket/:key', (req, res) => {
  const key = req.params.key;
  
  if (!key || clients[key]) {
    res.status(400).send('WebSocket for this key is already initialized or invalid key.');
    return;
  }
  
  res.send(`WebSocket path initialized for key: ${key}`);
});

// Start the HTTP server
server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
