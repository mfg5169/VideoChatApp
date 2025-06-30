// preload.js

// Import contextBridge and ipcRenderer from Electron.
// contextBridge allows safely exposing APIs from the preload script to the renderer process.
// ipcRenderer enables communication between the renderer and main processes.
const { contextBridge, ipcRenderer } = require('electron');

// Expose a custom API ('electronAPI') in the renderer's global window object.
// This API provides a method to get screen sources by invoking an IPC call to the main process.
contextBridge.exposeInMainWorld('electronAPI', {
  // getScreenSources: Calls the main process via IPC to retrieve available screen sources.
  getScreenSources: () =>
    ipcRenderer.invoke('get-screen-sources') // Calls main process
});
