const { app, BrowserWindow } = require('electron')

function createWindow () {
    
  const win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: true, // Optional: allows Node APIs in renderer
      contextIsolation: false
    }
  })

  win.loadFile('index.html')
}

app.whenReady().then(createWindow)
