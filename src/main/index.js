const { app, ipcMain, dialog, safeStorage } = require('electron');
const path = require('path');
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
});

registerDialogHandlers({ ipcMain, dialog, getMainWindow, REQ });
registerFsHandlers({ ipcMain, fsService, REQ });
registerWhisperHandlers({ ipcMain, whisperService, REQ });
registerSettingsHandlers({
  ipcMain,
  safeStorage,
  storage,
  providers,
  defaultProviderId: DEFAULT_PROVIDER,
  REQ,
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

app.whenReady().then(() => {
  registerMediaCapturePermissions();

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
