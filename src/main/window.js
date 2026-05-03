const { BrowserWindow } = require('electron');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..', '..');

let mainWindow = null;

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 420,
    webPreferences: {
      preload: path.join(projectRoot, 'src', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
  });

  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  window.loadFile(path.join(projectRoot, 'src', 'renderer', 'index.html'));
  return window;
}

function getMainWindow() {
  return mainWindow;
}

module.exports = {
  createWindow,
  getMainWindow,
};
