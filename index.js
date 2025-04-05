const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files for the web interface
app.use(express.static(path.join(__dirname, 'public')));

// Routes (Keep setup.html separate if preferred, or serve it too)
app.get('/', (req, res) => {
  // Redirect base path to setup instructions or the control page if key provided
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/setup.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});


// Store connected WebSocket clients by key
const clients = new Map(); // key -> WebSocket instance

// Helper function to send message safely
function safeSend(client, message) {
    if (client && client.readyState === WebSocket.OPEN) {
        client.send(message);
        return true;
    }
    return false;
}


// WebSocket connection handling
wss.on('connection', (ws, req) => {
    let key = ''; // Keep key in scope

    try {
        const urlParts = req.url.split('/');
        if (urlParts.length < 3 || urlParts[1] !== 'key' || !urlParts[2]) {
            console.log('Closing connection: Invalid key path format.', req.url);
            ws.close(1008, 'Invalid key path format.');
            return;
        }
        key = urlParts[2];

        // --- Disconnect existing client if any for the same key ---
        if (clients.has(key)) {
            const existingClient = clients.get(key);
            console.log(`Key ${key} already exists. Terminating old connection.`);
            existingClient.terminate(); // Force close old connection
            clients.delete(key); // Ensure removal if terminate is slow
        }
        // ---------------------------------------------------------

        clients.set(key, ws);
        ws.key = key; // Store key on the ws object itself
        console.log(`Client connected with key: ${key}`);

        // --- Logic to activate/deactivate Python client ---
        const isBrowserClient = key.endsWith('browser');
        const agentKey = isBrowserClient ? key.slice(0, -7) : key;
        const browserKey = isBrowserClient ? key : `${key}browser`;

        if (isBrowserClient) {
            // Browser connected: Notify the agent client
            const agentClient = clients.get(agentKey);
            if (agentClient) {
                console.log(`Browser ${key} connected. Activating agent ${agentKey}`);
                safeSend(agentClient, JSON.stringify({ action: 'remoteControlActive' }));
            } else {
                console.log(`Browser ${key} connected, but agent ${agentKey} not found.`);
                 // Optionally notify browser that agent isn't connected yet?
                 // safeSend(ws, JSON.stringify({ status: 'waiting_for_agent' }));
            }
        } else {
            // Agent connected: Check if browser is already waiting and activate
            const browserClient = clients.get(browserKey);
            if (browserClient) {
                console.log(`Agent ${key} connected. Activating now as browser ${browserKey} is present.`);
                safeSend(ws, JSON.stringify({ action: 'remoteControlActive' }));
            } else {
                 console.log(`Agent ${key} connected. Waiting for browser ${browserKey}.`);
            }
        }
        // ----------------------------------------------------


        // Health check with ping/pong (keep as is)
        const interval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.ping((err) => {
                    if (err) {
                        console.error(`Ping error for client ${ws.key}:`, err);
                        clearInterval(interval);
                        // Consider terminating connection if ping fails repeatedly
                        if (clients.get(ws.key) === ws) {
                             console.log(`Terminating unresponsive client ${ws.key}`);
                             clients.delete(ws.key);
                             ws.terminate();
                        }
                    }
                 });
            } else {
                clearInterval(interval);
            }
        }, 15000); // Ping every 15 seconds

        ws.on('pong', () => {
           // console.log(`Pong received from client: ${ws.key}`); // Can be noisy
        });

        // Handle incoming messages (Forwarding logic)
        ws.on('message', (message) => {
            try {
                // Determine target key
                const currentKey = ws.key;
                const isCurrentBrowser = currentKey.endsWith('browser');
                const targetKey = isCurrentBrowser
                  ? currentKey.slice(0, -7) // Browser sends to Agent
                  : `${currentKey}browser`; // Agent sends to Browser

                const targetClient = clients.get(targetKey);

                // Forward message if target exists and is open
                if (targetClient && targetClient.readyState === WebSocket.OPEN) {
                    // Forward raw message buffer for efficiency? Check if needed.
                    // If message is always JSON, stringify/parse is fine.
                    targetClient.send(message); // Forward the original message buffer/string
                } else {
                   // console.log(`Message from ${currentKey}, but target ${targetKey} not connected/ready.`);
                }

            } catch (error) {
                console.error(`Error processing message from ${ws.key}:`, error);
                // console.error("Received Message Content:", message.toString('utf8')); // Log content if error
            }
        });

        // Handle disconnection
        ws.on('close', (code, reason) => {
            console.log(`Client disconnected: ${ws.key}. Code: ${code}, Reason: ${reason ? reason.toString() : 'N/A'}`);
            clearInterval(interval); // Stop ping interval

            // Only delete if the disconnected client is the one currently stored for this key
            if (clients.get(ws.key) === ws) {
                clients.delete(ws.key);

                // --- Logic to deactivate the *other* client ---
                 const wasBrowserClient = ws.key.endsWith('browser');
                 const otherKey = wasBrowserClient ? ws.key.slice(0, -7) : `${ws.key}browser`;
                 const otherClient = clients.get(otherKey);

                 if (otherClient) {
                     console.log(`Client ${ws.key} disconnected. Notifying ${otherKey} to deactivate.`);
                     safeSend(otherClient, JSON.stringify({ action: 'remoteControlInactive' }));
                 }
                // --------------------------------------------
            } else {
                 console.log(`Client ${ws.key} closed, but wasn't the currently registered client (likely replaced).`);
            }
        });

        ws.on('error', (err) => {
            console.error(`WebSocket error on client ${ws.key}:`, err);
            clearInterval(interval);
             // Clean up on error as well
            if (clients.get(ws.key) === ws) {
                clients.delete(ws.key);
                 // Also notify the *other* client on error if it exists
                 const isCurrentBrowser = ws.key.endsWith('browser');
                 const otherKey = isCurrentBrowser ? ws.key.slice(0, -7) : `${ws.key}browser`;
                 const otherClient = clients.get(otherKey);
                 if (otherClient) {
                     console.log(`Client ${ws.key} errored. Notifying ${otherKey} to deactivate.`);
                     safeSend(otherClient, JSON.stringify({ action: 'remoteControlInactive' }));
                 }
            }
             // Consider closing ws here if not already closed
             try { ws.close(1011, "Internal Server Error"); } catch {}
        });

    } catch (error) {
         console.error("Error during WebSocket connection setup:", error);
         try { ws.close(1011, "Internal Server Error"); } catch {} // Attempt to close if ws exists
    }
});

// Endpoint to check if a key is valid/used (can replace initialize-socket)
// This is optional, Python script doesn't strictly need it anymore.
app.get('/check-key/:key', (req, res) => {
  const key = req.params.key;
  if (!key) {
    return res.status(400).send('Invalid key.');
  }
  // Check if agent or browser key exists
  const agentExists = clients.has(key) && clients.get(key).readyState === WebSocket.OPEN;
  const browserExists = clients.has(`${key}browser`) && clients.get(`${key}browser`).readyState === WebSocket.OPEN;

  if (agentExists || browserExists) {
      // Could return more detail, e.g., which part is connected
      res.status(200).json({ status: 'in_use_or_ready' });
  } else {
      res.status(404).json({ status: 'key_not_found' });
  }
});

// Remove or keep the initialize-socket endpoint?
// It doesn't do much now except confirm the route exists.
// Let's keep it for compatibility with the original Python script's check.
app.get('/initialize-socket/:key', (req, res) => {
    const key = req.params.key;
    if (!key) {
      res.status(400).send('Invalid key.');
      return;
    }
    // This endpoint now just confirms the server is running and the path is valid.
    // It doesn't reserve the key anymore, connection handling does that.
    res.status(200).send(`Server ready for WebSocket connection on key: ${key}`);
});


// Start the HTTP server (Use PORT environment variable for Render)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
