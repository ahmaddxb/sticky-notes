const { app, BrowserWindow, ipcMain, Tray, Menu, clipboard, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Proper Version Comparison Helper (Global)
function isNewer(v1, v2) {
    const parts1 = v1.split('.').map(num => parseInt(num, 10) || 0);
    const parts2 = v2.split('.').map(num => parseInt(num, 10) || 0);
    for (let i = 0; i < 3; i++) {
        if (parts1[i] > parts2[i]) return true;
        if (parts1[i] < parts2[i]) return false;
    }
    return false;
}

// --- 📝 EXTERNAL LOGGING SYSTEM 📝 ---
const userDataPath = app.getPath('userData');
const logFilePath = path.join(userDataPath, 'app.log');

// Create a custom logging function that writes to console AND file
function logToFile(msg, isError = false) {
    const timestamp = new Date().toISOString();
    const formattedMsg = `[${timestamp}] ${msg}${os.EOL}`;
    
    // Print to terminal
    if (isError) process.stderr.write(formattedMsg);
    else process.stdout.write(formattedMsg);

    // Append to file
    try {
        fs.appendFileSync(logFilePath, formattedMsg);
    } catch (e) {
        process.stderr.write(`Failed to write to log file: ${e.message}${os.EOL}`);
    }
}

// Intercept console.log and console.error to handle multiple arguments
console.log = (...args) => logToFile(args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' '));
console.error = (...args) => logToFile(args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' '), true);
console.warn = (...args) => logToFile(`[WARN] ${args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ')}`);

console.log('--- App Logging Started ---');
console.log('[Bootloader] Initial CORE_INJECTED:', process.env.CORE_INJECTED);
console.log('[Bootloader] App Path:', app.getAppPath());

// --- 🚀 BOOTLOADER 🚀 ---

// CRITICAL FIX: We only boot if the code is executing from the base folder, NOT from an ASAR.
// This prevents infinite loops and ensures we always jump out of the base folder to updates.
const isExecutingFromAsar = __dirname.toLowerCase().includes('.asar');
const shouldBoot = !isExecutingFromAsar;

if (shouldBoot) {
    const oldAppPath = app.getAppPath(); // resources/app
    const resourcesDir = path.join(oldAppPath, '..');
    
    // Also look in user-writable updates folder (works when installed to Program Files)
    const userUpdatesDir = path.join(app.getPath('userData'), 'updates');

    let bestAsar = null;
    let bestVersion = '0.0.0';

    // Helper: scan a directory for versioned update ASARs
    function scanForUpdates(dir) {
        try {
            const files = fs.readdirSync(dir);
            files.forEach(file => {
                if (file.startsWith('update_v') && file.endsWith('.asar')) {
                    const ver = file.replace('update_v', '').replace('.asar', '');
                    if (isNewer(ver, bestVersion)) {
                        bestVersion = ver;
                        bestAsar = path.join(dir, file);
                    }
                }
            });
        } catch (e) { /* dir may not exist or be readable */ }
    }

    scanForUpdates(resourcesDir);
    scanForUpdates(userUpdatesDir);

    // Also check legacy update.asar in resources
    try {
        const legacyPath = path.join(resourcesDir, 'update.asar');
        if (fs.existsSync(legacyPath)) {
            try {
                const legacyPkg = JSON.parse(fs.readFileSync(path.join(legacyPath, 'package.json'), 'utf8'));
                if (isNewer(legacyPkg.version, bestVersion)) {
                    bestVersion = legacyPkg.version;
                    bestAsar = legacyPath;
                }
            } catch (e) {}
        }
    } catch (e) {}

    console.log(`[Bootloader] Scanning resources: ${resourcesDir}`);
    console.log(`[Bootloader] Scanning user updates: ${userUpdatesDir}`);
    try {
        const checkFiles = fs.readdirSync(resourcesDir);
        console.log(`[Bootloader] Found ${checkFiles.length} files in resources: ${checkFiles.join(', ')}`);
    } catch(e) {}

    if (bestAsar) {
        try {
            console.log(`[Bootloader] Multi-Core detected. Booting highest: v${bestVersion} from ${bestAsar}`);
            
            const nodeModulesPath = path.join(oldAppPath, 'node_modules');
            process.env.NODE_PATH = nodeModulesPath + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '');
            require('module')._initPaths();

            process.env.CORE_INJECTED = 'true';
            require(path.join(bestAsar, 'main.js'));
            return; 
        } catch (err) {
            console.error('[Bootloader] Failed to boot into ASAR:', err);
        }
    } else {
        console.log('[Bootloader] No versioned update ASARs or legacy update.asar found in resources.');
    }
}

// --- UPDATER CONFIG ---
const UPDATER_URL = 'http://10.10.3.160:3001/update'; 

// userDataPath is now globally defined at the top
const appConfigPath = path.join(userDataPath, 'app-config.json');

let appConfig = { customNotesPath: null, syncServerUrl: null };
try {
  if (fs.existsSync(appConfigPath)) {
    appConfig = JSON.parse(fs.readFileSync(appConfigPath, 'utf8'));
  }
} catch (e) { /* ignore */ }

// CRITICAL: We MUST read the version from the same folder as this main.js
// otherwise we get version-mismatch loops when running from update.asar
let localVersion = '0.0.0';
try {
    const pkgPath = path.join(__dirname, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    localVersion = pkg.version;
    console.log(`[Main] SUCCESS: Running v${localVersion} from: ${__dirname}`);
    console.log(`[Main] ContextIsolation: Enabled, NodeIntegration: Disabled`);
} catch (e) {
    console.error('[Main] Version Read Error:', e.message);
}

function checkForUpdates(silent = true) {
  let baseUrl = UPDATER_URL;
  if (appConfig.syncServerUrl) {
      try {
          const parsed = new URL(appConfig.syncServerUrl);
          const proto = parsed.protocol.startsWith('wss') ? 'https:' : 'http:';
          baseUrl = `${proto}//${parsed.host}/update`;
      } catch (e) { console.error('[Updater] Invalid custom sync server URL'); }
  }
  
  const url = `${baseUrl}/version.json`;
  const client = url.startsWith('https') ? require('https') : require('http');
  
  console.log(`[Updater] Checking for updates at: ${url}`);
  
  const req = client.get(url, { rejectUnauthorized: false }, (res) => {
    if (res.statusCode !== 200) {
      console.error(`[Updater] Server Error: ${res.statusCode}`);
      return;
    }

    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const remote = JSON.parse(data);
        console.log(`[Updater] Versions -> Local: ${localVersion}, Remote: ${remote.version}`);

        if (remote.version && isNewer(remote.version, localVersion)) {
          // Check if we already have this version downloaded in resources
          const resourcesDir = path.join(app.getAppPath(), '..');
          const targetAsar = path.join(resourcesDir, `update_v${remote.version}.asar`);
          
          if (fs.existsSync(targetAsar)) {
            console.log(`[Updater] Newer version v${remote.version} is already downloaded but not active.`);
            if (!silent) {
                const choice = dialog.showMessageBoxSync({
                    type: 'info',
                    buttons: ['Restart Now', 'Later'],
                    title: 'Update Ready',
                    message: `Version ${remote.version} is already downloaded.`,
                    detail: `Would you like to restart the app to apply the update?`
                });
                if (choice === 0) {
                    const newEnv = { ...process.env };
                    delete newEnv.CORE_INJECTED;
                    app.relaunch({ env: newEnv });
                    app.exit(0);
                }
            }
            return;
          }

          const choice = dialog.showMessageBoxSync({
            type: 'question',
            buttons: ['Update Now', 'Later'],
            title: 'Update Available',
            message: `New version (${remote.version}) detected.`,
            detail: `You are currently running v${localVersion}. Would you like to update?`
          });
          
          if (choice === 0) {
            let dlUrl = remote.asarUrl;
            if (appConfig.syncServerUrl && dlUrl.includes('/update/update.asar')) {
                // Rewrite legacy absolute URLs if we are using a custom sync server
                dlUrl = `${baseUrl}/update.asar`;
            }
            downloadUpdate(remote.version, dlUrl);
          }
        } else if (!silent) {
          dialog.showMessageBoxSync({ message: `You are on the latest version (${localVersion}).` });
        }
      } catch (e) {
        console.error('[Updater] JSON Error:', e);
      }
    });
  });
  req.on('error', (e) => console.error('[Updater] Network Error:', e.message));
}

function downloadUpdate(targetVersion, url) {
  const client = url.startsWith('https') ? require('https') : require('http');
  const os = require('os');
  
  const tempPath = path.join(os.tmpdir(), 'update-' + Date.now() + '.tmp');
  
  // Save to user-writable updates folder so it works from Program Files installs too.
  // The bootloader scans both the resources dir AND this user updates dir.
  const userUpdatesDir = path.join(app.getPath('userData'), 'updates');
  if (!fs.existsSync(userUpdatesDir)) fs.mkdirSync(userUpdatesDir, { recursive: true });
  
  const targetPath = path.join(userUpdatesDir, `update_v${targetVersion}.asar`);

  console.log(`[Downloader] Target path: ${targetPath}`);

  const file = fs.createWriteStream(tempPath);
  client.get(url, { rejectUnauthorized: false }, (response) => {
    if (response.statusCode !== 200) {
      dialog.showErrorBox('Update Failed', `Server returned ${response.statusCode}`);
      return;
    }
    
    response.pipe(file);
    file.on('finish', () => {
      file.close(() => {
        try {
          fs.copyFileSync(tempPath, targetPath);
          fs.unlinkSync(tempPath); 
          
          // Log and immediately relaunch
          console.log('[Updater] Update applied successfully. Relaunching...');
          
          // CRITICAL: Ensure the environment is clean for the new process
          const newEnv = { ...process.env };
          delete newEnv.CORE_INJECTED; // Ensure bootloader re-runs on next start

          // app.relaunch() doesn't work for portable EXEs (they extract to temp).
          // Instead, spawn the actual executable path as a detached process.
          // PORTABLE_EXECUTABLE_FILE is set by electron-builder for portable EXEs.
          // For installed builds, fall back to process.execPath.
          const executablePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
          console.log(`[Updater] Relaunching from: ${executablePath}`);
          const { spawn } = require('child_process');
          const child = spawn(executablePath, ['--no-sandbox'], {
            detached: true,
            stdio: 'ignore',
            env: newEnv
          });
          child.unref();
          app.exit(0);
        } catch (err) {
          console.error('[Downloader] Copy error:', err.message);
          dialog.showErrorBox('Update Error', `Failed to save update: ${err.message}`);
        }
      });
    });
  }).on('error', (err) => {
    dialog.showErrorBox('Update Error', 'Download failed: ' + err.message);
  });
}

const crypto = require('crypto');
const { connectSyncServer, disconnectSyncServer, pushToServer, getSyncStatus } = require('./sync-client');

let notesFilePath = appConfig.customNotesPath 
  ? path.join(appConfig.customNotesPath, 'notes.json')
  : path.join(userDataPath, 'notes.json');

const layoutFilePath = path.join(userDataPath, 'layout.json');



let notesData = [];
let layoutData = {};

// Load notes from the sync folder
function loadNotesFromDisk() {
  try {
    if (fs.existsSync(notesFilePath)) {
      notesData = JSON.parse(fs.readFileSync(notesFilePath, 'utf8'));
    } else {
      notesData = [];
    }
  } catch (e) { 
    console.error('Error loading notes', e);
    notesData = [];
  }
}

// Load layout from the local machine folder
function loadLayoutData() {
  try {
    if (fs.existsSync(layoutFilePath)) {
      layoutData = JSON.parse(fs.readFileSync(layoutFilePath, 'utf8'));
    } else {
      layoutData = {};
    }
  } catch (e) {
    console.error('Error loading layout', e);
    layoutData = {};
  }
}

loadNotesFromDisk();
loadLayoutData();

// Ensure at least one note exists
if (notesData.length === 0) {
  const id = Date.now().toString();
  notesData.push({ id, content: '', name: '' });
  layoutData[id] = { width: 320, height: 380, isOpen: true };
}

let isSaving = false;
function saveNotesData() {
  try {
    isSaving = true;
    const syncData = notesData.map(n => ({ id: n.id, content: n.content, name: n.name }));
    
    // 1. Write to local/cloud drive file (if not using server-only mode)
    if (!appConfig.syncServerUrl || appConfig.customNotesPath) {
      fs.writeFileSync(notesFilePath, JSON.stringify(syncData, null, 2));
    }
    
    // 2. Push to sync server (if connected)
    pushToServer(syncData);
    
    setTimeout(() => { isSaving = false; }, 500);
  } catch (e) {
    console.error('Failed to save notes:', e);
    isSaving = false;
  }
}

let watcher = null;
function registerFileWatcher() {
  if (watcher) {
    fs.unwatchFile(notesFilePath);
  }

  // Disable file watcher if we are using an online sync server to avoid conflicts
  // (The server is now the Source of Truth)
  if (appConfig.syncServerUrl) {
    return;
  }
  // than fs.watch, which often fails to trigger on network/virtual mounts.
  fs.watchFile(notesFilePath, { interval: 2000 }, (curr, prev) => {
    if (curr.mtime !== prev.mtime && !isSaving) {
      console.log('[Sync] External change detected, reloading...');
      
      const oldNotesStr = JSON.stringify(notesData);
      loadNotesFromDisk();
      
      if (oldNotesStr !== JSON.stringify(notesData)) {
        // 1. Update/Close windows
        const currentIds = notesData.map(n => n.id);
        
        // Find orphan windows (notes that were deleted externally)
        Object.keys(activeWindows).forEach(id => {
          if (!currentIds.includes(id)) {
            console.log(`[Sync] Note ${id} was deleted externally, closing window.`);
            const win = activeWindows[id];
            if (win && !win.isDestroyed()) win.close();
            delete activeWindows[id];
            if (layoutData[id]) {
              layoutData[id].isOpen = false;
              saveLayoutData();
            }
          }
        });

        // Update remaining windows
        notesData.forEach(note => {
          const win = activeWindows[note.id];
          if (win && !win.isDestroyed()) {
            win.webContents.send('load-note', note);
            win.setTitle(note.name || 'Sticky Note');
          }
        });
        
        if (tray) tray.setContextMenu(buildTrayMenu());
      }
    }
  });
}

registerFileWatcher();

function saveLayoutData() {
  try {
    fs.writeFileSync(layoutFilePath, JSON.stringify(layoutData, null, 2));
  } catch (e) {
    console.error('Failed to save layout to', layoutFilePath, e);
  }
}

// Module-level so it can be referenced from both whenReady and tray menu handlers
let applyServerNotes = null;

let tray = null;
const activeWindows = {}; // map of id to BrowserWindow

// --- IPC HANDLERS ---
ipcMain.on('log-renderer', (event, msg) => {
  console.log(`[Renderer] ${msg}`);
});

function createNoteWindow(note) {
  console.log(`[Main] Creating window for note: ${note.id}`);
  const layout = layoutData[note.id] || { width: 320, height: 380 };

  const win = new BrowserWindow({
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    minWidth: 200,
    minHeight: 200,
    frame: false,
    transparent: true,
    resizable: true,
    thickFrame: true,
    alwaysOnTop: false,
    skipTaskbar: true,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  console.log(`[Main] Loading UI from: ${path.join(__dirname, 'index.html')}`);
  win.loadFile(path.join(__dirname, 'index.html'));

  win.webContents.on('did-finish-load', () => {
    console.log(`[Main] Window finished load: ${note.id}`);
    const latestNote = notesData.find(n => n.id === note.id);
    if (latestNote) {
      win.webContents.send('load-note', latestNote);
    }
  });

  win.on('move', () => {
    const bounds = win.getBounds();
    if (!layoutData[note.id]) layoutData[note.id] = { isOpen: true };
    layoutData[note.id].x = bounds.x;
    layoutData[note.id].y = bounds.y;
    saveLayoutData();
  });

  win.on('resize', () => {
    const bounds = win.getBounds();
    if (!layoutData[note.id]) layoutData[note.id] = { isOpen: true };
    layoutData[note.id].width = bounds.width;
    layoutData[note.id].height = bounds.height;
    saveLayoutData();
  });

  win.on('close', () => {
    delete activeWindows[note.id];
  });

  activeWindows[note.id] = win;
}

app.whenReady().then(() => {
  console.log('[Main] App is ready, initializing windows and services...');
  
  // Custom update check on startup
  setTimeout(() => checkForUpdates(true), 5000); 

  // Only open notes that were previously open on this computer
  notesData.forEach(note => {
    if (layoutData[note.id] && layoutData[note.id].isOpen) {
      createNoteWindow(note);
    }
  });



  // ── WebSocket Sync Server connection ────────────────────────────────────────
  applyServerNotes = function(incomingNotes) {
    // Don't apply if we are currently saving (prevents echo)
    if (isSaving) return;

    // SMART SYNC: If the server is empty (new setup) but we already have notes locally,
    // we should push our local notes to the server rather than letting the server wipe us out.
    if ((!incomingNotes || incomingNotes.length === 0) && notesData.length > 0) {
      console.log('[Sync] Server is empty, seeding server with local notes...');
      const syncData = notesData.map(n => ({ id: n.id, content: n.content, name: n.name }));
      pushToServer(syncData);
      return;
    }

    const oldStr = JSON.stringify(notesData);
    notesData = incomingNotes || [];

    // Also update file on disk so local file watcher stays consistent
    try {
      fs.writeFileSync(notesFilePath, JSON.stringify(notesData, null, 2));
    } catch (e) { /* best effort */ }

    if (oldStr !== JSON.stringify(notesData)) {
      const currentIds = notesData.map(n => n.id);

      // Close windows for deleted notes
      Object.keys(activeWindows).forEach(id => {
        if (!currentIds.includes(id)) {
          const win = activeWindows[id];
          if (win && !win.isDestroyed()) win.close();
          delete activeWindows[id];
          if (layoutData[id]) { layoutData[id].isOpen = false; saveLayoutData(); }
        }
      });

      // Update existing windows
      notesData.forEach(note => {
        const win = activeWindows[note.id];
        if (win && !win.isDestroyed()) {
          win.webContents.send('load-note', note);
          win.setTitle(note.name || 'Sticky Note');
        }
      });

      if (tray) tray.setContextMenu(buildTrayMenu());
    }
  }

  function connectSyncClient() {
    if (!appConfig.syncServerUrl) return;
    connectSyncServer(
      appConfig.syncServerUrl,
      localVersion, // Pass current version to server
      applyServerNotes,
      (status) => {
        console.log(`[SyncClient] Status: ${status}`);
        if (tray) tray.setToolTip(`My Sticky Notes — Server: ${status}`);
        if (tray) tray.setContextMenu(buildTrayMenu());
      },
      (newVersion) => {
        console.log(`[Main] PROACTIVE UPDATE: Server announced v${newVersion}`);
        checkForUpdates(true); // Trigger a silent background update check
      }
    );
  }

  connectSyncClient();

  // --- TRAY SETUP ---
  const iconPath = path.join(__dirname, 'icon.png');
  tray = new Tray(iconPath);
  tray.setToolTip('My Sticky Notes');
  tray.setContextMenu(buildTrayMenu());

  tray.on('click', () => {
    const windows = Object.values(activeWindows);
    const anyVisible = windows.some(w => w.isVisible());
    windows.forEach(w => {
        if (anyVisible) w.hide();
        else { w.show(); w.focus(); }
    });
  });
});

function setSyncFolder() {
  const result = dialog.showOpenDialogSync({
    title: 'Select Sync Folder (e.g. Dropbox/Notes)',
    properties: ['openDirectory']
  });

  if (result && result.length > 0) {
    const newPath = result[0];
    const newNotesFile = path.join(newPath, 'notes.json');

    if (!fs.existsSync(newNotesFile) && fs.existsSync(notesFilePath)) {
      try {
        fs.copyFileSync(notesFilePath, newNotesFile);
      } catch (e) {
        dialog.showErrorBox('Sync Error', 'Could not copy notes to the new folder: ' + e.message);
        return;
      }
    }

    appConfig.customNotesPath = newPath;
    fs.writeFileSync(appConfigPath, JSON.stringify(appConfig, null, 2));

    notesFilePath = newNotesFile;
    registerFileWatcher(); 
    Object.values(activeWindows).forEach(win => { if(!win.isDestroyed()) win.close(); });
    
    loadNotesFromDisk();
    notesData.forEach(note => {
      if (layoutData[note.id] && layoutData[note.id].isOpen) {
        createNoteWindow(note);
      }
    });

    if (tray) tray.setContextMenu(buildTrayMenu());

    dialog.showMessageBoxSync({
      type: 'info',
      title: 'Sync Folder Set',
      message: `Your notes are now being saved to:\n${newPath}`
    });
  }
}

function resetSyncFolder() {
  appConfig.customNotesPath = null;
  fs.writeFileSync(appConfigPath, JSON.stringify(appConfig, null, 2));
  
  notesFilePath = path.join(userDataPath, 'notes.json');
  registerFileWatcher();
  Object.values(activeWindows).forEach(win => { if(!win.isDestroyed()) win.close(); });
  
  loadNotesFromDisk();
  notesData.forEach(note => {
    if (layoutData[note.id] && layoutData[note.id].isOpen) {
      createNoteWindow(note);
    }
  });

  if (tray) tray.setContextMenu(buildTrayMenu());

  dialog.showMessageBoxSync({
    type: 'info',
    title: 'Sync Reset',
    message: 'Storage has been reset to the default local folder.'
  });
}

function buildTrayMenu() {
  const syncLabel = appConfig.customNotesPath 
    ? `📁 Syncing to: ${path.basename(appConfig.customNotesPath)}...`
    : '☁️ Setup Cloud Sync...';

  return Menu.buildFromTemplate([
    { label: `My Sticky Notes v${localVersion}`, enabled: false },
    { type: 'separator' },
    { label: 'New Note', click: () => {
        const newNote = { id: Date.now().toString(), content: '', name: '' };
        notesData.push(newNote);
        layoutData[newNote.id] = { width: 320, height: 380, isOpen: true };
        saveNotesData();
        saveLayoutData();
        createNoteWindow(newNote);
        tray.setContextMenu(buildTrayMenu());
      }
    },
    { type: 'separator' },
    {
      label: 'Note Library (All Notes)',
      submenu: notesData.sort((a,b) => (b.id - a.id)).map(n => {
        const isOpen = !!activeWindows[n.id];
        const displayName = (n.name && n.name.trim() !== '') ? n.name : 'Untitled Note';
        return {
          label: (isOpen ? '● ' : '○ ') + displayName,
          click: () => {
            if (activeWindows[n.id]) {
              activeWindows[n.id].show();
              activeWindows[n.id].focus();
            } else {
              if (!layoutData[n.id]) layoutData[n.id] = {};
              layoutData[n.id].isOpen = true;
              saveLayoutData();
              createNoteWindow(n);
              tray.setContextMenu(buildTrayMenu());
            }
          }
        };
      })
    },
    { label: 'Show/Hide All Windows', click: () => {
        const windows = Object.values(activeWindows);
        const anyVisible = windows.some(w => w.isVisible());
        windows.forEach(w => {
            if (anyVisible) w.hide();
            else { w.show(); w.focus(); }
        });
        if (!anyVisible && windows.length === 0) {
            const lastNote = notesData[notesData.length - 1];
            if (lastNote) {
              if (!layoutData[lastNote.id]) layoutData[lastNote.id] = {};
              layoutData[lastNote.id].isOpen = true;
              saveLayoutData();
              createNoteWindow(lastNote);
              tray.setContextMenu(buildTrayMenu());
            }
        }
      }
    },
    { type: 'separator' },
    { 
      label: 'Cloud Sync Settings', 
      submenu: [
        { label: '🔄 Refresh from Cloud Now', click: () => {
            loadNotesFromDisk();
            registerFileWatcher(); // Restart watcher
            notesData.forEach(note => {
              const win = activeWindows[note.id];
              if (win && !win.isDestroyed()) win.webContents.send('load-note', note);
            });
            if (tray) tray.setContextMenu(buildTrayMenu());
            dialog.showMessageBoxSync({ title: 'Sync', message: 'Notes reloaded from disk.' });
          }
        },
        { type: 'separator' },
        { label: '📁 Set Sync Folder...', click: setSyncFolder },
        { label: '♻️ Reset Folder to Default', enabled: !!appConfig.customNotesPath, click: resetSyncFolder },
        { type: 'separator' },
        { type: 'separator' },
        { 
          label: (() => {
            if (!appConfig.syncServerUrl) return '🔴 Connect to Sync Server...';
            const status = getSyncStatus();
            let icon = '🔴';
            if (status === 'connected') icon = '🟢';
            else if (status === 'connecting') icon = '🟡';
            let host = '...';
            try {
              host = new URL(appConfig.syncServerUrl).host;
            } catch (e) {
              host = 'invalid URL';
            }
            return `${icon} Server: ${status} (${host})`;
          })(),
          click: () => {
            // Show a dialog instructing the user how to connect
            const current = appConfig.syncServerUrl || 'wss://your-server-url.com/?key=yourkey';
            const choice = dialog.showMessageBoxSync({
              type: 'question',
              title: 'Connect to Sync Server',
              message: 'Enter your Sync Server WebSocket URL below.',
              detail: `Current: ${current}\n\nLocal Format: ws://YOUR_IP:3001?key=YOUR_KEY\nProxy Format: wss://YOUR_DOMAIN/?key=YOUR_KEY\n\n1. Log in to your Sync Server dashboard\n2. Create or copy your Personal Sync Key.\n3. Update the URL in app-config.json and click Reconnect Now.`,
              buttons: ['Reconnect Now', 'Open Config File', 'Cancel']
            });
            if (choice === 0) {
              try {
                if (fs.existsSync(appConfigPath)) {
                  appConfig = JSON.parse(fs.readFileSync(appConfigPath, 'utf8'));
                }
              } catch (e) { console.error('[Config] Error reading app-config', e); }

              if (appConfig.syncServerUrl) {
                disconnectSyncServer();
                connectSyncServer(
                  appConfig.syncServerUrl,
                  localVersion,
                  applyServerNotes,
                  (status) => {
                    if (tray) tray.setToolTip(`My Sticky Notes — Server: ${status}`);
                    if (tray) tray.setContextMenu(buildTrayMenu());
                  },
                  (newVersion) => {
                    console.log(`[Main] PROACTIVE UPDATE: Server announced v${newVersion}`);
                    checkForUpdates(true);
                  }
                );
              }
            } else if (choice === 1) {
              require('child_process').exec(`notepad "${appConfigPath}"`);
            }
          }
        },
        { 
          label: '⛔ Disconnect Server',
          enabled: !!appConfig.syncServerUrl,
          click: () => {
            disconnectSyncServer();
            appConfig.syncServerUrl = null;
            fs.writeFileSync(appConfigPath, JSON.stringify(appConfig, null, 2));
            tray.setToolTip('My Sticky Notes');
            tray.setContextMenu(buildTrayMenu());
          }
        }
      ]
    },
    { label: '✨ Check for Updates...', click: () => checkForUpdates(false) },
    { 
      label: '🛠  Clear Updates & Reset…', 
      click: () => {
          const choice = dialog.showMessageBoxSync({
              type: 'warning',
              buttons: ['Clear & Restart', 'Cancel'],
              title: 'Reset Application',
              message: 'This will delete all downloaded update ASARs and restart from the base version.'
          });
          if (choice === 0) {
              const resourcesDir = path.join(app.getAppPath(), '..');
              const files = fs.readdirSync(resourcesDir);
              files.forEach(file => {
                  if (file.endsWith('.asar') && (file.startsWith('update_v') || file === 'update.asar')) {
                      try { fs.unlinkSync(path.join(resourcesDir, file)); } catch(e) {}
                  }
              });
              const newEnv = { ...process.env };
              delete newEnv.CORE_INJECTED;
              app.relaunch({ env: newEnv });
              app.exit(0);
          }
      }
    },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (menuItem) => {
        app.setLoginItemSettings({ openAtLogin: menuItem.checked });
      }
    },

    { type: 'separator' },
    { label: 'View Logs', click: () => {
        const { spawn } = require('child_process');
        spawn('cmd', ['/c', 'start', 'powershell', '-NoExit', '-Command', `Get-Content "${logFilePath}" -Wait -Tail 10`], {
          detached: true,
          stdio: 'ignore'
        }).unref();
      }
    },
    { label: 'Quit', click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
}

ipcMain.on('save-content', (event, id, content) => {
    const note = notesData.find(n => n.id === id);
    if (note) {
        note.content = content;
        saveNotesData();
        // Update tray in case content was first line or triggered a change
        if (tray) tray.setContextMenu(buildTrayMenu());
    }
});

ipcMain.on('save-name', (event, id, name) => {
    const note = notesData.find(n => n.id === id);
    if (note) {
        note.name = name;
        saveNotesData();
        // Update the OS window title too
        const win = activeWindows[id];
        if (win && !win.isDestroyed()) {
            win.setTitle(name || 'Sticky Note');
        }
        // Update tray menu immediately
        if (tray) tray.setContextMenu(buildTrayMenu());
    }
});


ipcMain.on('close-note', (event, id) => {
    if (layoutData[id]) {
        layoutData[id].isOpen = false;
        saveLayoutData();
    }
    const win = activeWindows[id];
    if (win) win.close();
    tray.setContextMenu(buildTrayMenu());
});

ipcMain.on('delete-note-permanent', (event, id) => {
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['Delete Everywhere', 'Cancel'],
      title: 'Delete Permanently',
      message: 'This will delete the note and its content from all computers and your sync folder.'
    });

    if (choice === 0) {
      notesData = notesData.filter(n => n.id !== id);
      delete layoutData[id];
      saveNotesData();
      saveLayoutData();
      const win = activeWindows[id];
      if (win) win.close();
      tray.setContextMenu(buildTrayMenu());
    }
});

ipcMain.on('new-note', () => {
    const newNote = { id: Date.now().toString(), content: '', name: '' };
    notesData.push(newNote);
    layoutData[newNote.id] = { width: 320, height: 380, isOpen: true };
    saveNotesData();
    saveLayoutData();
    createNoteWindow(newNote);
    tray.setContextMenu(buildTrayMenu());
});

ipcMain.on('resize-window', (event, { width, height }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) {
    const bounds = win.getBounds();
    win.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: width,
      height: height
    });
    
    // Explicitly update layout data for this note
    for (const [id, w] of Object.entries(activeWindows)) {
      if (w === win) {
        if (!layoutData[id]) layoutData[id] = { isOpen: true };
        layoutData[id].width = width;
        layoutData[id].height = height;
        saveLayoutData();
        break;
      }
    }
  }
});

app.on('window-all-closed', () => {
  // Overwrite default electron behavior that would otherwise kill the app entirely
});
