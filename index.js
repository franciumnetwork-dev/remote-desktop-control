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

// Store connected WebSocket clients by key
const clients = new Map();

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  const urlParts = req.url.split('/');
  
  if (urlParts[1] === 'key' && urlParts[2]) {
    const key = urlParts[2];

    // Check if the key is already in use
    if (clients.has(key)) {
      const existingClient = clients.get(key);
      if (existingClient.readyState === WebSocket.OPEN) {
        ws.close(1008, 'Key already in use');
        console.log(`Key already in use: ${key}`);
        return;
      } else {
        // If the existing client is disconnected, remove it
        clients.delete(key);
        console.log(`Removed stale client for key: ${key}`);
      }
    }

    // Assign the key to the new connection
    clients.set(key, ws);
    ws.key = key;
    console.log(`Connected to client with key: ${key}`);

    // Health check with ping/pong
    const interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      } else {
        clearInterval(interval);
      }
    }, 10000); // Every 10 seconds

    ws.on('pong', () => {
      console.log(`Pong received from client with key: ${ws.key}`);
    });

    // Handle incoming messages
    ws.on('message', (message) => {
      try {
        const msg = JSON.parse(message);

        // Broadcast to all clients except the sender
        clients.forEach((client, clientKey) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(msg));
          }
        });
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });

    // Handle disconnection
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

// Endpoint to initialize the WebSocket path for a given key
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

// Start the HTTP server
server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
