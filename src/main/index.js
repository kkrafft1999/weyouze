const { app, ipcMain, dialog, safeStorage, Menu, shell } = require('electron');
const path = require('path');

// macOS: damit in der Menue-Bar ueber dem Bildschirm "Weyouze Anything" statt
// "Electron" erscheint (zumindest in den Submenus: "Ueber Weyouze Anything",
// "Weyouze Anything beenden" usw.). Im Packaged-Build kommt der Name aus dem
// productName in package.json -> Info.plist; im Dev-Mode liest macOS den
// FETTEN App-Title links neben dem Apfel allerdings aus dem Bundle der
// laufenden node_modules/electron/dist/Electron.app, daher kann dort trotz
// app.setName() weiterhin "Electron" stehen. Das ist ein bekanntes macOS-
// Limit, kein Bug der App.
app.setName('Weyouze Anything');
const fs = require('fs/promises');
const providers = require('./providers');
const { createWindow, getMainWindow } = require('./window');
const { registerMediaCapturePermissions } = require('./permissions');
const { REQUEST_CHANNELS: REQ, PUSH_CHANNELS: PUSH } = require('../shared/ipc-channels');
const { createStorageService } = require('./services/storage-service');
const { createFsService } = require('./services/fs-service');
const { createWhisperService } = require('./services/whisper-service');
const { createUpdateService } = require('./services/update-service');
const { createWorkspaceToolRegistry } = require('./tools/workspace-tool-registry');
const { registerDialogHandlers } = require('./ipc/dialog-handlers');
const { registerFsHandlers } = require('./ipc/fs-handlers');
const { registerWhisperHandlers } = require('./ipc/whisper-handlers');
const { registerSettingsHandlers } = require('./ipc/settings-handlers');
const { createSettingsPresentationService } = require('./services/settings-presentation-service');
const { registerChatHistoryHandlers } = require('./ipc/chat-history-handlers');
const { registerChatHandlers } = require('./ipc/chat-handlers');
const { registerUpdateHandlers } = require('./ipc/update-handlers');
const workspaceState = require('./workspace-state');
const { LIMITS } = require('../shared/limits');

const DEFAULT_PROVIDER = 'openai';

const storage = createStorageService({
  app,
  safeStorage,
  fs,
  path,
  providers,
  maxChatSessions: LIMITS.MAX_CHAT_SESSIONS,
  maxFolderHistory: LIMITS.MAX_FOLDER_HISTORY,
  defaultProviderId: DEFAULT_PROVIDER,
});

const fsService = createFsService({
  fs,
  path,
  maxReadFileBytes: LIMITS.MAX_READ_FILE_BYTES,
  maxWriteFileBytes: LIMITS.MAX_WRITE_FILE_BYTES,
});
const toolRegistry = createWorkspaceToolRegistry({ fsService });

const whisperService = createWhisperService({
  fetchImpl: fetch,
  getOpenAIApiKey: () => storage.getOpenAIApiKey(),
  getAppLocale: async () => {
    const prefs = await storage.readUIPrefs();
    return prefs.appLocale;
  },
});

const updateService = createUpdateService({ app, storage });

registerDialogHandlers({ ipcMain, dialog, getMainWindow, REQ });
registerFsHandlers({
  ipcMain,
  fsService,
  REQ,
  getActiveWorkspaceRoot: workspaceState.getActiveWorkspaceRoot,
});
registerWhisperHandlers({ ipcMain, whisperService, storage, REQ });
const settingsPresentation = createSettingsPresentationService({
  providers,
  defaultProviderId: DEFAULT_PROVIDER,
});

registerSettingsHandlers({
  ipcMain,
  safeStorage,
  storage,
  providers,
  defaultProviderId: DEFAULT_PROVIDER,
  REQ,
  setActiveWorkspaceRoot: workspaceState.setActiveWorkspaceRoot,
  presentation: settingsPresentation,
});
registerChatHistoryHandlers({ ipcMain, storage, REQ });
registerUpdateHandlers({ ipcMain, updateService, REQ });
registerChatHandlers({
  ipcMain,
  storage,
  providers,
  toolRegistry,
  path,
  defaultProviderId: DEFAULT_PROVIDER,
  maxToolRounds: LIMITS.MAX_TOOL_ROUNDS,
  REQ,
  PUSH,
});

// Fragt den Update-Service und schickt das Ergebnis an den Renderer. silent=true
// (Auto-Check beim Start) respektiert eine zuvor uebersprungene Version und
// meldet sich nur bei einem echten Treffer; bei silent=false (manueller Check
// ueber das Menue) kommt das Ergebnis immer, damit der Renderer auch
// "Du bist aktuell" oder einen Fehler anzeigen kann.
async function runUpdateCheck({ silent }) {
  const result = await updateService.checkForUpdate({ respectIgnored: silent });
  const win = getMainWindow();
  if (!win || win.isDestroyed()) return;
  if (silent && !result.updateAvailable) return;
  win.webContents.send(PUSH.UPDATE_AVAILABLE, { ...result, manual: !silent });
}

function buildApplicationMenu() {
  // Auf macOS muss das ERSTE Submenu den App-Namen als label tragen — das ist
  // der fett gedruckte Eintrag rechts neben dem Apfel. Auf Windows/Linux gibt
  // es kein App-Menue, dort beginnen wir direkt mit Datei/Bearbeiten.
  const isMac = process.platform === 'darwin';
  const appName = app.getName();

  const macAppMenu = {
    label: appName,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide', label: `${appName} ausblenden` },
      { role: 'hideOthers', label: 'Andere ausblenden' },
      { role: 'unhide', label: 'Alle einblenden' },
      { type: 'separator' },
      { role: 'quit', label: `${appName} beenden` },
    ],
  };

  const editMenu = {
    label: 'Bearbeiten',
    submenu: [
      { role: 'undo', label: 'Rueckgaengig' },
      { role: 'redo', label: 'Wiederholen' },
      { type: 'separator' },
      { role: 'cut', label: 'Ausschneiden' },
      { role: 'copy', label: 'Kopieren' },
      { role: 'paste', label: 'Einfuegen' },
      { role: 'selectAll', label: 'Alles auswaehlen' },
    ],
  };

  const viewMenu = {
    label: 'Ansicht',
    submenu: [
      { role: 'reload', label: 'Neu laden' },
      { role: 'forceReload', label: 'Hart neu laden' },
      { role: 'toggleDevTools', label: 'Entwicklertools' },
      { type: 'separator' },
      { role: 'resetZoom', label: 'Zoom zuruecksetzen' },
      { role: 'zoomIn', label: 'Vergroessern' },
      { role: 'zoomOut', label: 'Verkleinern' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: 'Vollbild' },
    ],
  };

  const windowMenu = {
    label: 'Fenster',
    role: 'window',
    submenu: [
      { role: 'minimize', label: 'Im Dock ablegen' },
      { role: 'zoom', label: 'Vollbild Fenster' },
      ...(isMac ? [{ type: 'separator' }, { role: 'front', label: 'Alle nach vorne' }] : [{ role: 'close', label: 'Schliessen' }]),
    ],
  };

  const helpMenu = {
    label: 'Hilfe',
    role: 'help',
    submenu: [
      {
        label: 'Nach Updates suchen…',
        click: () => { void runUpdateCheck({ silent: false }); },
      },
      { type: 'separator' },
      {
        label: 'Projekt auf GitHub',
        click: () => shell.openExternal('https://github.com/kkrafft1999/weyouze'),
      },
    ],
  };

  const template = [
    ...(isMac ? [macAppMenu] : []),
    editMenu,
    viewMenu,
    windowMenu,
    helpMenu,
  ];

  return Menu.buildFromTemplate(template);
}

app.whenReady().then(async () => {
  registerMediaCapturePermissions();

  Menu.setApplicationMenu(buildApplicationMenu());

  const lastFolder = await storage.getValidatedLastFolder();
  if (lastFolder) {
    workspaceState.setActiveWorkspaceRoot(lastFolder);
  }

  createWindow();

  // Verzoegerter Auto-Check, damit der Start nicht auf das Netzwerk wartet.
  setTimeout(() => { void runUpdateCheck({ silent: true }); }, 4000);

  app.on('activate', () => {
    if (!getMainWindow()) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  providers.disposeAll();
});
