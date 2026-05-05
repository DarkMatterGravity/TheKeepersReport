const { contextBridge } = require('electron');

// Expose a minimal API to the renderer
// The renderer will use fetch directly since we're just calling public APIs
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform
});
