/**
 * sync-client.js
 * WebSocket client that connects the Electron app to the Sync Server.
 * 
 * Usage in main.js:
 *   const { connectSyncServer, disconnectSyncServer, pushToServer } = require('./sync-client');
 */

const WebSocket = require('ws');

let ws = null;
let serverUrl = null;
let reconnectTimer = null;
let isShuttingDown = false;

// Callbacks registered by main.js
let onNotesReceived = null;  // called when server pushes updated notes
let onStatusChange  = null;  // called with 'connected' | 'disconnected' | 'error'
let onUpdatePushed  = null;  // called when server announces a new update

let clientVersion = '0.0.0'; 
const RECONNECT_DELAY_MS = 5000;

function connect(url) {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return; // Already connected/connecting
  }

  console.log(`[SyncClient] Connecting to ${url}`);
  onStatusChange && onStatusChange('connecting');

  try {
    // Auto-correct http/https to ws/wss
    if (url.startsWith('http://')) url = url.replace('http://', 'ws://');
    if (url.startsWith('https://')) url = url.replace('https://', 'wss://');

    // Add options to support self-signed certs and HTTP->HTTPS redirects behind proxies
    const options = {
      rejectUnauthorized: false,
      followRedirects: true
    };
    ws = new WebSocket(url, options);
  } catch (e) {
    console.error(`[SyncClient] Failed to create WebSocket for ${url}:`, e.message);
    onStatusChange && onStatusChange('error');
    return;
  }

  ws.on('open', () => {
    console.log('[SyncClient] Connected to sync server');
    onStatusChange && onStatusChange('connected');
    
    // Announce version to server immediately
    if (clientVersion !== '0.0.0') {
        ws.send(JSON.stringify({ event: 'version-report', payload: clientVersion }));
    }

    clearTimeout(reconnectTimer);
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.event === 'init' || msg.event === 'notes-updated') {
        console.log(`[SyncClient] Received ${msg.event} (${msg.payload.length} notes)`);
        onNotesReceived && onNotesReceived(msg.payload);
      } else if (msg.event === 'update-available') {
        console.log(`[SyncClient] Server announced new version: ${msg.payload}`);
        onUpdatePushed && onUpdatePushed(msg.payload);
      }
    } catch (e) {
      console.error('[SyncClient] Bad message:', e.message);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[SyncClient] Disconnected (code ${code}: ${reason})`);
    onStatusChange && onStatusChange('disconnected');
    ws = null;

    if (!isShuttingDown) {
      reconnectTimer = setTimeout(() => connect(serverUrl), RECONNECT_DELAY_MS);
    }
  });

  ws.on('error', (err) => {
    console.error('[SyncClient] WebSocket error:', err.message);
    onStatusChange && onStatusChange('error');
    ws && ws.terminate();
    ws = null;

    if (!isShuttingDown) {
      reconnectTimer = setTimeout(() => connect(serverUrl), RECONNECT_DELAY_MS);
    }
  });
}

/**
 * Connect to a sync server.
 * @param {string} url - WebSocket URL e.g. ws://1.2.3.4:3001?key=mykey
 * @param {string} version - Current local application version
 * @param {function} receivedCallback - Called with (notesArray) when server sends an update
 * @param {function} statusCallback   - Called with (statusString) on connection state change
 * @param {function} updatePushedCallback - Called when server notifies of a new version available
 */
function connectSyncServer(url, version, receivedCallback, statusCallback, updatePushedCallback) {
  isShuttingDown = false;
  serverUrl = url;
  clientVersion = version;
  onNotesReceived = receivedCallback;
  onStatusChange  = statusCallback;
  onUpdatePushed  = updatePushedCallback;
  connect(url);
}

/**
 * Push the current notes to the server (which then broadcasts to other clients).
 * @param {Array} notes - Array of note objects { id, content, name }
 */
function pushToServer(notes) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: 'push-notes', payload: notes }));
  } else {
    console.warn('[SyncClient] Cannot push — not connected');
  }
}

/**
 * Get the current WebSocket connection status.
 */
function getSyncStatus() {
  if (!serverUrl) return 'disabled';
  if (!ws)       return 'disconnected';
  switch (ws.readyState) {
    case WebSocket.CONNECTING: return 'connecting';
    case WebSocket.OPEN:       return 'connected';
    default:                   return 'disconnected';
  }
}

/**
 * Disconnect from the server and stop reconnecting.
 */
function disconnectSyncServer() {
  isShuttingDown = true;
  clearTimeout(reconnectTimer);
  if (ws) {
    ws.close();
    ws = null;
  }
  serverUrl = null;
  onStatusChange && onStatusChange('disabled');
}

module.exports = { connectSyncServer, disconnectSyncServer, pushToServer, getSyncStatus };
