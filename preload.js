const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    closeNote: (id) => ipcRenderer.send('close-note', id),
    deleteNotePermanent: (id) => ipcRenderer.send('delete-note-permanent', id),
    newNote: () => ipcRenderer.send('new-note'),
    saveContent: (id, content) => ipcRenderer.send('save-content', id, content),
    saveName: (id, name) => ipcRenderer.send('save-name', id, name),
    resizeWindow: (width, height) => ipcRenderer.send('resize-window', { width, height }),
    logToServer: (msg) => ipcRenderer.send('log-renderer', msg),
    onLoadNote: (callback) => ipcRenderer.on('load-note', (event, note) => callback(note))
});
