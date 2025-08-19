// Import necessary Electron modules
const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const path = require('path');

// Function to create the main application window
function createWindow () {
  const win = new BrowserWindow({
    width: 1000, // Set window width
    height: 800, // Set window height
    webPreferences: {
      preload: path.join(__dirname, 'client-electronapp/preload.js'), // Preload script
      contextIsolation: true, // Enable context isolation for security
      nodeIntegration: false, // Disable Node.js integration in renderer

      sandbox: true,
      webSecurity: true,

    }
  });

  win.loadFile('./client-electronapp/index.html'); // Load the main HTML file
  win.webContents.openDevTools(); // Open DevTools for debugging
}

// Handle IPC call from renderer to get screen and window sources
ipcMain.handle('get-screen-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
  return sources; // Return the list of sources
});

console.log("Opening Application");

// Enable screen capturing for user media
app.commandLine.appendSwitch('enable-usermedia-screen-capturing');

// Create the window when Electron is ready
app.whenReady().then(createWindow);
