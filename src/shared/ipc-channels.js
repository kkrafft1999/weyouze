/**
 * Zentrale Definition aller IPC-Kanaele zwischen Main und Renderer.
 *
 * Quelle: Anhang A der REFACTORING_PLAN.md (Stand vor Modularisierung).
 * Jeder Kanal hier muss exakt dem entsprechen, was main.js sendet/registriert
 * und preload.js verbindet — beim Refactoring nicht stillschweigend umbenennen.
 *
 * CommonJS, damit main.js und preload.js die Datei direkt per require nutzen
 * koennen, solange das Projekt kein "type": "module" gesetzt hat.
 */

// Request/Response (ipcMain.handle <-> ipcRenderer.invoke)
const REQUEST_CHANNELS = Object.freeze({
  DIALOG_OPEN_FOLDER: 'dialog:openFolder',

  FS_READ_DIRECTORY: 'fs:readDirectory',
  FS_READ_FILE: 'fs:readFile',
  FS_MOVE_ITEM: 'fs:moveItem',

  SETTINGS_GET_LLM_STATE: 'settings:getLLMState',
  SETTINGS_SET_PROVIDER: 'settings:setProvider',
  SETTINGS_SET_ACTIVE_PROVIDER: 'settings:setActiveProvider',
  SETTINGS_SET_ACTIVE_PRESET: 'settings:setActivePreset',
  SETTINGS_COMMIT_SETTINGS: 'settings:commitSettings',
  SETTINGS_LIST_MODELS: 'settings:listModels',

  SETTINGS_GET_LAST_FOLDER: 'settings:getLastFolder',
  SETTINGS_SET_LAST_FOLDER: 'settings:setLastFolder',
  SETTINGS_GET_FOLDER_HISTORY: 'settings:getFolderHistory',
  SETTINGS_GET_UI_PREFS: 'settings:getUIPrefs',
  SETTINGS_SET_UI_PREFS: 'settings:setUIPrefs',

  CHAT_HISTORY_GET: 'chatHistory:get',
  CHAT_HISTORY_UPSERT: 'chatHistory:upsert',
  CHAT_HISTORY_DELETE: 'chatHistory:delete',
  CHAT_HISTORY_SET_ACTIVE: 'chatHistory:setActive',

  CHAT_SEND: 'openai:chat',

  WHISPER_TRANSCRIBE: 'whisper:transcribe',
});

// Push-Kanaele (webContents.send -> ipcRenderer.on).
// Werden vom Main aktiv an den Renderer gepusht und sind kein invoke().
const PUSH_CHANNELS = Object.freeze({
  CHAT_DELTA: 'openai:chat:delta',
  CHAT_TOOL_LINE: 'openai:chat:tool-line',
  CHAT_PROGRESS: 'openai:chat:progress',
});

module.exports = {
  REQUEST_CHANNELS,
  PUSH_CHANNELS,
};
