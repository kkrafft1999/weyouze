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
const { registerDialogHandlers } = require('./ipc/dialog-handlers');
const { registerFsHandlers } = require('./ipc/fs-handlers');
const { registerWhisperHandlers } = require('./ipc/whisper-handlers');
const { registerSettingsHandlers } = require('./ipc/settings-handlers');
const { registerChatHistoryHandlers } = require('./ipc/chat-history-handlers');
const { registerChatHandlers } = require('./ipc/chat-handlers');
const workspaceState = require('./workspace-state');

const MAX_CHAT_SESSIONS = 200;
const MAX_FOLDER_HISTORY = 10;
const DEFAULT_PROVIDER = 'openai';
const MAX_TOOL_ROUNDS = 14;
const MAX_READ_FILE_BYTES = 2 * 1024 * 1024;

const WORKSPACE_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description:
        'Listet Dateien und Unterordner in einem Verzeichnis relativ zum geöffneten Projektordner (ohne versteckte Einträge, die mit . beginnen).',
      parameters: {
        type: 'object',
        properties: {
          relative_path: {
            type: 'string',
            description:
              'Relativer Pfad zum Ordner; leerer String oder "." für das Projektroot.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file_text',
      description:
        'Liest den Textinhalt einer Datei als UTF-8 (nur innerhalb des Projektordners).',
      parameters: {
        type: 'object',
        properties: {
          relative_path: {
            type: 'string',
            description: 'Relativer Pfad zur Datei, z. B. "package.json" oder "src/app.js".',
          },
          max_characters: {
            type: 'integer',
            description:
              'Maximale Zeichenanzahl des zurückgegebenen Texts (Standard 32000, Obergrenze 200000).',
          },
        },
        required: ['relative_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'debug_wait',
      description:
        'Nur zum UI-Test: wartet eine konfigurierbare Zeit und liefert danach OK zurück. Kein Dateizugriff.',
      parameters: {
        type: 'object',
        properties: {
          duration_seconds: {
            type: 'number',
            description:
              'Wartezeit in Sekunden (Standard 5, Minimum 0,5, Maximum 20).',
          },
        },
      },
    },
  },
];

const storage = createStorageService({
  app,
  safeStorage,
  fs,
  path,
  providers,
  maxChatSessions: MAX_CHAT_SESSIONS,
  maxFolderHistory: MAX_FOLDER_HISTORY,
  defaultProviderId: DEFAULT_PROVIDER,
});

const fsService = createFsService({
  fs,
  path,
  maxReadFileBytes: MAX_READ_FILE_BYTES,
});

const whisperService = createWhisperService({
  fetchImpl: fetch,
  getOpenAIApiKey: () => storage.getOpenAIApiKey(),
  getAppLocale: async () => {
    const prefs = await storage.readUIPrefs();
    return prefs.appLocale;
  },
});

registerDialogHandlers({ ipcMain, dialog, getMainWindow, REQ });
registerFsHandlers({
  ipcMain,
  fsService,
  REQ,
  getActiveWorkspaceRoot: workspaceState.getActiveWorkspaceRoot,
});
registerWhisperHandlers({ ipcMain, whisperService, storage, REQ });
registerSettingsHandlers({
  ipcMain,
  safeStorage,
  storage,
  providers,
  defaultProviderId: DEFAULT_PROVIDER,
  REQ,
  setActiveWorkspaceRoot: workspaceState.setActiveWorkspaceRoot,
});
registerChatHistoryHandlers({ ipcMain, storage, REQ });
registerChatHandlers({
  ipcMain,
  storage,
  providers,
  fsService,
  path,
  defaultProviderId: DEFAULT_PROVIDER,
  maxToolRounds: MAX_TOOL_ROUNDS,
  workspaceTools: WORKSPACE_TOOLS,
  REQ,
  PUSH,
});

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
