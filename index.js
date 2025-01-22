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

// Store connected WebSocket clients by their key
let clients = {}; // For storing controller-client mappings
let assignedKeys = {}; // Maps keys to users (controlling and controlled client)

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  const urlParts = req.url.split('/');
  
  if (urlParts[1] === 'key' && urlParts[2]) {
    const key = urlParts[2];

    // Check if the key has already been assigned to a controlled computer
    if (assignedKeys[key] && assignedKeys[key] !== ws) {
      ws.close(1008, 'Key is already in use for controlling another client');
      console.log(`Key ${key} is already assigned. New connection rejected.`);
      return;
    }

    // If the key is not in use, assign it to this connection
    if (!assignedKeys[key]) {
      assignedKeys[key] = ws; // Assign key to the controlling client (first connection)
      console.log(`Assigned key ${key} to controlling client.`);
    }

    clients[key] = ws;
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

    // Handle incoming messages (control messages)
    ws.on('message', (message) => {
      try {
        const msg = JSON.parse(message);

        // Send control messages to the client associated with the key
        const targetClient = assignedKeys[key];
        if (targetClient && targetClient.readyState === WebSocket.OPEN) {
          targetClient.send(JSON.stringify(msg));
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });

    // Handle disconnection
    ws.on('close', () => {
      if (ws.key && clients[ws.key] === ws) {
        delete clients[ws.key];
        delete assignedKeys[ws.key]; // Free the key once the client disconnects
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

  if (assignedKeys[key]) {
    res.status(400).send('WebSocket for this key is already initialized and in use.');
    return;
  }
  
  res.send(`WebSocket path initialized for key: ${key}`);
});

// Start the HTTP server
server.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
