const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  readDirectory: (dirPath) => ipcRenderer.invoke('fs:readDirectory', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
  moveItem: (sourcePath, destDir) => ipcRenderer.invoke('fs:moveItem', sourcePath, destDir),

  // LLM provider settings (multi-provider)
  getLLMState: () => ipcRenderer.invoke('settings:getLLMState'),
  setProvider: (payload) => ipcRenderer.invoke('settings:setProvider', payload),
  clearProvider: (providerId) => ipcRenderer.invoke('settings:clearProvider', providerId),
  setActiveProvider: (providerId) => ipcRenderer.invoke('settings:setActiveProvider', providerId),
  listModels: (payload) => ipcRenderer.invoke('settings:listModels', payload),

  getLastFolder: () => ipcRenderer.invoke('settings:getLastFolder'),
  setLastFolder: (folderPath) => ipcRenderer.invoke('settings:setLastFolder', folderPath),
  getFolderHistory: () => ipcRenderer.invoke('settings:getFolderHistory'),
  getUIPrefs: () => ipcRenderer.invoke('settings:getUIPrefs'),
  setUIPrefs: (partial) => ipcRenderer.invoke('settings:setUIPrefs', partial),
  getChatHistory: (workspaceRoot) => ipcRenderer.invoke('chatHistory:get', workspaceRoot ?? null),
  upsertChatSession: (session) => ipcRenderer.invoke('chatHistory:upsert', session),
  deleteChatSession: (id) => ipcRenderer.invoke('chatHistory:delete', id),
  setActiveChatId: (workspaceRoot, id) => ipcRenderer.invoke('chatHistory:setActive', workspaceRoot ?? null, id),
  chat: (messages, options) =>
    ipcRenderer.invoke('openai:chat', {
      messages,
      workspaceRoot: options?.workspaceRoot ?? null,
      selectedPath: options?.selectedPath ?? null,
      selectedIsDirectory: options?.selectedIsDirectory ?? false,
    }),
  onChatDelta: (callback) => {
    const channel = 'openai:chat:delta';
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onChatToolLine: (callback) => {
    const channel = 'openai:chat:tool-line';
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  onChatProgress: (callback) => {
    const channel = 'openai:chat:progress';
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  transcribeAudio: (audioBuffer) => ipcRenderer.invoke('whisper:transcribe', audioBuffer),
  openExternal: (url) => {
    try {
      const u = new URL(url);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        shell.openExternal(url);
      }
    } catch {
      /* ignore invalid URL */
    }
  },
});
