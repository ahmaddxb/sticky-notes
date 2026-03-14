const express = require('express');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const session = require('express-session');
const { WebSocketServer } = require('ws');

// ── Config ────────────────────────────────────────────────────────────────────
const PORT      = process.env.PORT      || 3001;
// CHANGE THESE: Use environment variables in production
const SYNC_KEY  = process.env.SYNC_KEY  || 'change-this-for-security';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'server-notes.json');
const USER_FILE = process.env.USER_FILE || path.join(__dirname, 'users.json');
const SESSION_SECRET = process.env.SESSION_SECRET || 'sticky-notes-default-session-secret';

// ── Persistence ───────────────────────────────────────────────────────────────
let users = [];
let notes = {};

function ensureDir(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadData() {
    ensureDir(USER_FILE);
    ensureDir(DATA_FILE);
    try {
        if (fs.existsSync(USER_FILE)) {
            const data = JSON.parse(fs.readFileSync(USER_FILE, 'utf8'));
            users = data.users || [];
            
            // Migration: Convert single apiKey to apiKeys array if needed
            users.forEach(u => {
                if (u.apiKey && !u.apiKeys) {
                    u.apiKeys = [{
                        id: 'k_default_' + Date.now(),
                        key: u.apiKey,
                        label: 'Primary Key',
                        createdAt: new Date().toISOString()
                    }];
                    delete u.apiKey;
                }
                if (!u.apiKeys) u.apiKeys = [];
            });
        }

        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            
            // Migration: Convert old global array format to per-user object format
            if (Array.isArray(data)) {
                console.log('[Store] Migrating global notes array to first admin user...');
                const admin = users.find(u => u.isAdmin) || users[0];
                notes = {};
                if (admin) notes[admin.id] = data;
            } else {
                notes = data || {};
            }
        }
    } catch (e) {
        console.error('[Store] Read error:', e.message);
    }
}

function saveData() {
    try {
        ensureDir(USER_FILE);
        ensureDir(DATA_FILE);
        fs.writeFileSync(USER_FILE, JSON.stringify({ users }, null, 2));
        fs.writeFileSync(DATA_FILE, JSON.stringify(notes, null, 2));
    } catch (e) {
        console.error('[Store] Write error:', e.message);
    }
}

loadData();

// ── Express App ───────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// Auth Middlewares
const requireAuth = (req, res, next) => {
    if (req.session.userId) next();
    else res.status(401).json({ error: 'Unauthorized' });
};

const requireAdmin = (req, res, next) => {
    const user = users.find(u => u.id === req.session.userId);
    if (user && user.isAdmin) next();
    else res.status(403).json({ error: 'Admin only' });
};

// API Key Auth Middleware (for REST API)
const apiKeyAuth = (req, res, next) => {
    const key = req.query.key || req.headers['x-api-key'];
    if (!key) return res.status(401).json({ error: 'API Key required' });

    const user = users.find(u => 
        (u.apiKeys && u.apiKeys.some(k => k.key === key)) || 
        (u.apiKey === key) ||
        (key === SYNC_KEY && u.isAdmin)
    );

    if (!user) return res.status(401).json({ error: 'Invalid API Key' });
    req.user = user;
    next();
};

// ── Static Routes ─────────────────────────────────────────────────────────────
app.get('/dashboard.html', (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login.html');
    next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.redirect('/login.html'));

// ── Auth Endpoints ────────────────────────────────────────────────────────────
app.get('/auth/check', (req, res) => {
    if (req.session.userId) res.sendStatus(200);
    else res.sendStatus(401);
});

app.post('/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        req.session.userId = user.id;
        res.json({ ok: true });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login.html');
});

// ── API Endpoints ─────────────────────────────────────────────────────────────
app.get('/api/me', requireAuth, (req, res) => {
    const user = users.find(u => u.id === req.session.userId);
    const { password, ...safeUser } = user;
    res.json(safeUser);
});

app.post('/api/me/password', requireAuth, (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const user = users.find(u => u.id === req.session.userId);

    if (user.password !== currentPassword) {
        return res.status(400).json({ error: 'Incorrect current password' });
    }
    
    if (!newPassword || newPassword.length < 1) {
        return res.status(400).json({ error: 'New password cannot be empty' });
    }

    user.password = newPassword;
    saveData();
    res.json({ ok: true });
});

// API Key Management
app.get('/api/keys', requireAuth, (req, res) => {
    const user = users.find(u => u.id === req.session.userId);
    res.json(user.apiKeys || []);
});

app.post('/api/keys', requireAuth, (req, res) => {
    const { label } = req.body;
    const user = users.find(u => u.id === req.session.userId);
    const newKey = {
        id: 'k_' + crypto.randomBytes(8).toString('hex'),
        key: 'snk_' + crypto.randomBytes(24).toString('hex'),
        label: label || 'New Key',
        createdAt: new Date().toISOString()
    };
    if (!user.apiKeys) user.apiKeys = [];
    user.apiKeys.push(newKey);
    saveData();
    res.json(newKey);
});

app.delete('/api/keys/:id', requireAuth, (req, res) => {
    const user = users.find(u => u.id === req.session.userId);
    user.apiKeys = user.apiKeys.filter(k => k.id !== req.params.id);
    saveData();
    res.json({ ok: true });
});

// ── Notes Data API ─────────────────────────────────────────────────────────────
app.post('/api/notes', apiKeyAuth, (req, res) => {
    const incoming = req.body;
    if (!incoming.id) incoming.id = String(Date.now());
    
    if (!notes[req.user.id]) notes[req.user.id] = [];
    const userNotes = notes[req.user.id];
    
    const index = userNotes.findIndex(n => n.id === incoming.id);
    if (index !== -1) {
        userNotes[index] = { ...userNotes[index], ...incoming, updatedAt: new Date().toISOString() };
    } else {
        userNotes.push({ ...incoming, updatedAt: new Date().toISOString() });
    }
    
    saveData();
    // Broadcast change to active WebSocket clients if they belong to this user
    broadcastToUser(req.user.id, 'notes-updated', userNotes);
    res.json(userNotes.find(n => n.id === incoming.id));
});

// Helper to strip HTML and return clean text
function cleanText(html) {
    if (!html) return '';
    return html
        .replace(/<br\/?>/gi, '\n')
        .replace(/<\/div>|<\/p>|<\/li>|<\/h[1-6]>/gi, '\n')
        .replace(/<[^>]+>/g, '') // Strip all other tags
        .replace(/&nbsp;/g, ' ')
        .replace(/\n\s*\n/g, '\n') // Collapse empty lines
        .trim();
}

// Helper to split HTML into "lines" based on block tags or breaks
function splitIntoLines(html) {
    if (!html) return [];
    const regex = /<(p|div|h[1-6]|li|ul|ol)[^>]*>.*?<\/\1>|<br\/?>|[^<>]+(?=<br\/?>|$)/gi;
    return html.match(regex) || [html];
}

app.delete('/api/notes/:id', apiKeyAuth, (req, res) => {
    if (!notes[req.user.id]) return res.json({ ok: true });
    notes[req.user.id] = notes[req.user.id].filter(n => n.id !== req.params.id);
    saveData();
    broadcastToUser(req.user.id, 'notes-updated', notes[req.user.id]);
    res.json({ ok: true });
});

app.get('/api/notes', apiKeyAuth, (req, res) => {
    const userNotes = (notes[req.user.id] || []).map(n => ({
        ...n,
        text: cleanText(n.content),
        lines: splitIntoLines(n.content).map(l => cleanText(l))
    }));
    res.json(userNotes);
});

app.get('/api/notes/:id', apiKeyAuth, (req, res) => {
    const userNotes = notes[req.user.id] || [];
    const note = userNotes.find(n => n.id === req.params.id);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    
    res.json({
        ...note,
        text: cleanText(note.content),
        lines: splitIntoLines(note.content).map(l => cleanText(l))
    });
});

app.get('/api/notes/:id/lines', apiKeyAuth, (req, res) => {
    const { id } = req.params;
    if (!notes[req.user.id]) return res.status(404).json({ error: 'No notes found' });
    const note = notes[req.user.id].find(n => n.id === id);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const rawLines = splitIntoLines(note.content);
    res.json(rawLines.map((html, index) => ({ 
        index, 
        text: cleanText(html),
        html: html
    })));
});

app.post('/api/notes/:id/lines', apiKeyAuth, (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content required' });

    const userNotes = notes[req.user.id];
    if (!userNotes) return res.status(404).json({ error: 'No notes found' });
    const note = userNotes.find(n => n.id === id);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    note.content += content;
    note.updatedAt = new Date().toISOString();
    
    saveData();
    broadcastToUser(req.user.id, 'notes-updated', userNotes);
    res.json(note);
});

app.patch('/api/notes/:id/lines/:index', apiKeyAuth, (req, res) => {
    const { id, index } = req.params;
    const { content } = req.body;
    const lineIndex = parseInt(index);

    if (!notes[req.user.id]) return res.status(404).json({ error: 'No notes found' });
    const userNotes = notes[req.user.id];
    const note = userNotes.find(n => n.id === id);
    if (!note) return res.status(404).json({ error: 'Note not found' });

    const lines = splitIntoLines(note.content);

    if (lineIndex < 0 || lineIndex >= lines.length) {
        return res.status(400).json({ error: `Invalid index. Note has ${lines.length} lines.` });
    }

    lines[lineIndex] = content;
    note.content = lines.join('');
    note.updatedAt = new Date().toISOString();
    
    saveData();
    broadcastToUser(req.user.id, 'notes-updated', userNotes);
    res.json(note);
});

// Admin APIs
app.get('/api/admin/users', [requireAuth, requireAdmin], (req, res) => {
    res.json(users.map(u => {
        const { password, ...safe } = u;
        return safe;
    }));
});

app.post('/api/admin/users', [requireAuth, requireAdmin], (req, res) => {
    const { username, password, isAdmin } = req.body;
    if (users.find(u => u.username === username)) return res.status(400).json({ error: 'Exists' });
    
    const newUser = {
        id: 'u_' + Date.now(),
        username,
        password,
        isAdmin: !!isAdmin,
        apiKeys: [{
            id: 'k_' + crypto.randomBytes(8).toString('hex'),
            key: 'snk_' + crypto.randomBytes(24).toString('hex'),
            label: 'Default Key',
            createdAt: new Date().toISOString()
        }]
    };
    users.push(newUser);
    saveData();
    res.json(newUser);
});

app.delete('/api/admin/users/:id', [requireAuth, requireAdmin], (req, res) => {
    if (req.params.id === req.session.userId) return res.status(400).json({ error: 'Cannot delete self' });
    users = users.filter(u => u.id !== req.params.id);
    delete notes[req.params.id];
    saveData();
    res.json({ ok: true });
});

// ── Legacy Update Route ───────────────────────────────────────────────────────
app.use('/update', express.static(path.join(__dirname, 'updates')));

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'ok', clients: wss ? wss.clients.size : 0 });
});

// ── WebSocket Server ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

function broadcastToUser(userId, event, payload, excludeWs = null) {
  const msg = JSON.stringify({ event, payload });
  wss.clients.forEach(client => {
    if (client.userId === userId && client !== excludeWs && client.readyState === 1) {
      client.send(msg);
    }
  });
}

wss.on('connection', (ws, req) => {
  const urlParams = new URL(req.url, `http://${req.headers.host}`).searchParams;
  const key = urlParams.get('key');
  
  // Find user by any of their API keys (or legacy apiKey property)
  let user = users.find(u => 
      (u.apiKeys && u.apiKeys.some(k => k.key === key)) || 
      (u.apiKey === key)
  );

  // Fallback: If no user found, check if the key matches the master SYNC_KEY 
  // and map it to the first admin (legacy behavior)
  if (!user && key === SYNC_KEY) {
      user = users.find(u => u.isAdmin) || users[0];
  }
  
  if (!user) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  ws.userId = user.id;
  ws.clientId = crypto.randomBytes(2).toString('hex');
  
  console.log(`[WS] User ${user.username} connected (${ws.clientId})`);

  // Send initials
  ws.send(JSON.stringify({ event: 'init', payload: notes[user.id] || [] }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.event === 'push-notes' && Array.isArray(msg.payload)) {
        notes[user.id] = msg.payload;
        saveData();
        broadcastToUser(user.id, 'notes-updated', msg.payload, ws);
      } else if (msg.event === 'version-report') {
        ws.clientVersion = msg.payload;
        checkAndNotifyUpdates(ws);
      }
    } catch (e) { console.error('[WS] Error:', e.message); }
  });

  ws.on('close', () => console.log(`[WS] ${ws.clientId} disconnected`));
});

// ── Update Push System ────────────────────────────────────────────────────────
const VERSION_FILE = path.join(__dirname, 'updates', 'version.json');
let latestVersion = '0.0.0';

function readLatestVersion() {
  try {
    if (fs.existsSync(VERSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
      if (data.version && isNewer(data.version, latestVersion)) {
        latestVersion = data.version;
        wss.clients.forEach(c => checkAndNotifyUpdates(c));
      }
    }
  } catch (e) {}
}

function checkAndNotifyUpdates(client) {
  if (client.readyState === 1 && latestVersion !== '0.0.0' && isNewer(latestVersion, client.clientVersion)) {
    client.send(JSON.stringify({ event: 'update-available', payload: latestVersion }));
  }
}

function isNewer(v1, v2) {
    if (!v1 || !v2) return false;
    const p1 = v1.split('.').map(n => parseInt(n) || 0);
    const p2 = v2.split('.').map(n => parseInt(n) || 0);
    for (let i = 0; i < 3; i++) {
        if (p1[i] > p2[i]) return true;
        if (p1[i] < p2[i]) return false;
    }
    return false;
}

if (fs.existsSync(path.dirname(VERSION_FILE))) {
    fs.watch(path.dirname(VERSION_FILE), (et, fn) => { if (fn === 'version.json') readLatestVersion(); });
}
readLatestVersion();

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║      My Sticky Notes ─ Sync Server       ║
╠══════════════════════════════════════════╣
║  HTTP/WS Port : ${String(PORT).padEnd(24)}║
║  Data file    : ${path.basename(DATA_FILE).padEnd(24)}║
║  Dashboard    : http://localhost:${PORT.toString().padEnd(8)}║
╚══════════════════════════════════════════╝

Server is running and ready for connections.
`);
});

