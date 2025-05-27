const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  Menu.setApplicationMenu(null); // Remove top bar
  win.loadFile('public/index.html');

  ipcMain.on('window-control', (event, action) => {
    if (action === 'close') win.close();
    if (action === 'min') win.minimize();
    if (action === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  });
}

app.whenReady().then(() => {
  createWindow();
});
