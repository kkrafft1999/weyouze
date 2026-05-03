const { app, ipcMain, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const providers = require('./src/main/providers');
const { createWindow, getMainWindow } = require('./src/main/window');
const { registerMediaCapturePermissions } = require('./src/main/permissions');
const { REQUEST_CHANNELS: REQ, PUSH_CHANNELS: PUSH } = require('./src/shared/ipc-channels');
const { createStorageService } = require('./src/main/services/storage-service');
const { createFsService } = require('./src/main/services/fs-service');
const { createWhisperService } = require('./src/main/services/whisper-service');

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

function workspaceSystemPrompt(workspaceRoot, selectedRelPath, selectedIsDirectory) {
  const name = path.basename(workspaceRoot);
  let prompt =
    `Du hilfst beim Durchsuchen des in der App geöffneten Ordners („${name}“). ` +
    `Du hast die Tools list_directory und read_file_text. Nutze nur relative Pfade zum Ordnerroot ` +
    `(z. B. "" oder "." für die Wurzel, "src/index.js" für eine Datei). ` +
    `Antworte auf Deutsch, sachlich und knapp.`;
  if (selectedRelPath) {
    const kind = selectedIsDirectory ? 'Ordner' : 'Datei';
    prompt +=
      `\n\nDer Nutzer hat gerade folgende ${kind} im Baum ausgewählt: „${selectedRelPath}". ` +
      `Beziehe dich bei Fragen ohne expliziten Pfad auf diese Auswahl.`;
  }
  return prompt;
}

function truncateToolLabel(s, max = 48) {
  const t = String(s ?? '');
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function summarizeToolCall(toolName, args) {
  if (toolName === 'list_directory') {
    const p =
      typeof args.relative_path === 'string' && args.relative_path.trim()
        ? args.relative_path.trim()
        : '.';
    return `list_directory(${truncateToolLabel(p)})`;
  }
  if (toolName === 'read_file_text') {
    const p = typeof args.relative_path === 'string' ? args.relative_path.trim() : '?';
    return `read_file_text(${truncateToolLabel(p)})`;
  }
  return truncateToolLabel(toolName || 'tool');
}

function emitChatProgress(webContents, payload) {
  if (webContents && !webContents.isDestroyed()) {
    webContents.send(PUSH.CHAT_PROGRESS, payload);
  }
}

function makeStreamCallbacks(webContents) {
  let started = false;
  const markGenerating = () => {
    if (started) return;
    started = true;
    emitChatProgress(webContents, { type: 'phase', phase: 'generating' });
  };
  return {
    reset() { started = false; },
    onMarkGenerating: markGenerating,
    onTextDelta(text) {
      if (!text) return;
      markGenerating();
      if (webContents && !webContents.isDestroyed()) {
        webContents.send(PUSH.CHAT_DELTA, { text });
      }
    },
    onReasoningDelta(text) {
      if (!text) return;
      markGenerating();
      emitChatProgress(webContents, { type: 'reasoning', text });
    },
  };
}

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

// ── IPC Handlers ──

ipcMain.handle(REQ.DIALOG_OPEN_FOLDER, async () => {
  const result = await dialog.showOpenDialog(getMainWindow(), {
    title: 'Ordner auswählen',
    buttonLabel: 'Ordner öffnen',
    message: 'Wähle einen Ordner aus, der angezeigt werden soll',
    properties: ['openDirectory'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle(REQ.FS_READ_DIRECTORY, async (_event, dirPath) => {
  try {
    return await fsService.readDirectory(dirPath);
  } catch (err) {
    console.error('readDirectory error:', err.message);
    return [];
  }
});

ipcMain.handle(REQ.FS_MOVE_ITEM, async (_event, sourcePath, destDir) => {
  try {
    return await fsService.moveItem(sourcePath, destDir);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(REQ.FS_READ_FILE, async (_event, filePath) => {
  try {
    return await fsService.readFilePreview(filePath);
  } catch (err) {
    return { error: err.message };
  }
});

// ── Whisper speech-to-text (uses OpenAI provider key) ──

ipcMain.handle(REQ.WHISPER_TRANSCRIBE, async (_event, audioBuffer) => {
  return whisperService.transcribeAudio(audioBuffer);
});

// ── LLM provider settings ──

ipcMain.handle(REQ.SETTINGS_GET_LLM_STATE, async () => {
  const encryptionAvailable = safeStorage.isEncryptionAvailable();
  const config = await storage.readLLMConfig();
  const meta = providers.listProviderMeta();
  const list = meta.map((m) => {
    const entry = (config.providers && config.providers[m.id]) || {};
    const hasKey = m.fields.apiKey ? !!entry.apiKeyEnc : false;
    const baseUrl = m.fields.baseUrl ? (entry.baseUrl || m.defaultBaseUrl) : '';
    const configured = m.fields.apiKey
      ? hasKey
      : m.fields.baseUrl
        ? !!baseUrl
        : true;
    return {
      ...m,
      configured,
      hasKey,
      model: entry.model || m.defaultModel,
      baseUrl,
    };
  });
  const active = config.activeProvider || DEFAULT_PROVIDER;
  return { encryptionAvailable, activeProvider: active, providers: list };
});

ipcMain.handle(REQ.SETTINGS_SET_PROVIDER, async (_event, payload) => {
  const providerId = payload?.providerId;
  const provider = providers.getProvider(providerId);
  if (!provider) return { ok: false, error: 'Unbekannter Provider.' };

  const config = await storage.readLLMConfig();
  const prevEntry = (config.providers && config.providers[providerId]) || {};
  const next = { ...prevEntry };

  if (provider.fields?.apiKey) {
    const incomingKey = typeof payload?.apiKey === 'string' ? payload.apiKey.trim() : '';
    if (incomingKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        return { ok: false, error: 'Verschlüsselter Speicher ist nicht verfügbar.' };
      }
      next.apiKeyEnc = safeStorage.encryptString(incomingKey).toString('base64');
    } else if (!prevEntry.apiKeyEnc) {
      return { ok: false, error: 'API-Key darf nicht leer sein.' };
    }
  }

  if (provider.fields?.baseUrl) {
    const incomingUrl = typeof payload?.baseUrl === 'string' ? payload.baseUrl.trim() : '';
    if (incomingUrl) {
      next.baseUrl = incomingUrl;
    } else if (!prevEntry.baseUrl) {
      next.baseUrl = provider.defaultBaseUrl || '';
    }
  }

  if (typeof payload?.model === 'string' && payload.model.trim()) {
    next.model = payload.model.trim();
  } else if (!next.model) {
    next.model = provider.defaultModel;
  }

  config.providers = config.providers || {};
  config.providers[providerId] = next;
  if (payload?.makeActive) {
    config.activeProvider = providerId;
  } else if (!config.activeProvider) {
    config.activeProvider = providerId;
  }
  await storage.writeLLMConfig(config);
  return { ok: true };
});

ipcMain.handle(REQ.SETTINGS_CLEAR_PROVIDER, async (_event, providerId) => {
  if (!providers.getProvider(providerId)) return { ok: false, error: 'Unbekannter Provider.' };
  const config = await storage.readLLMConfig();
  if (config.providers) delete config.providers[providerId];
  if (config.activeProvider === providerId) {
    const fallback = providers.PROVIDER_ORDER.find(
      (id) => config.providers && config.providers[id]
    );
    config.activeProvider = fallback || DEFAULT_PROVIDER;
  }
  await storage.writeLLMConfig(config);
  return { ok: true };
});

ipcMain.handle(REQ.SETTINGS_SET_ACTIVE_PROVIDER, async (_event, providerId) => {
  if (!providers.getProvider(providerId)) {
    return { ok: false, error: 'Unbekannter Provider.' };
  }
  const config = await storage.readLLMConfig();
  config.activeProvider = providerId;
  await storage.writeLLMConfig(config);
  return { ok: true };
});

ipcMain.handle(REQ.SETTINGS_LIST_MODELS, async (_event, payload) => {
  const providerId = payload?.providerId;
  const provider = providers.getProvider(providerId);
  if (!provider) return { error: 'Unbekannter Provider.' };

  const stored = (await storage.getEffectiveProviderConfig(providerId)) || {};
  const incomingKey = typeof payload?.apiKey === 'string' && payload.apiKey.trim()
    ? payload.apiKey.trim()
    : null;
  const incomingUrl = typeof payload?.baseUrl === 'string' && payload.baseUrl.trim()
    ? payload.baseUrl.trim()
    : null;

  const config = {
    apiKey: incomingKey || stored.apiKey || '',
    baseUrl: incomingUrl || stored.baseUrl || provider.defaultBaseUrl || '',
  };
  try {
    return await provider.listModels(config);
  } catch (err) {
    return { error: err.message || 'Modelle konnten nicht geladen werden.' };
  }
});

// ── Last folder, UI prefs, chat history ──

ipcMain.handle(REQ.SETTINGS_GET_LAST_FOLDER, async () => {
  const folderPath = await storage.getValidatedLastFolder();
  return { folderPath };
});

ipcMain.handle(REQ.SETTINGS_SET_LAST_FOLDER, async (_event, folderPath) => {
  await storage.persistLastFolder(folderPath);
  return { ok: true };
});

ipcMain.handle(REQ.SETTINGS_GET_FOLDER_HISTORY, async () => {
  const paths = await storage.getValidatedFolderHistory();
  return { paths };
});

ipcMain.handle(REQ.SETTINGS_GET_UI_PREFS, async () => storage.readUIPrefs());

ipcMain.handle(REQ.SETTINGS_SET_UI_PREFS, async (_event, partial) => {
  const patch = partial && typeof partial === 'object' ? partial : {};
  const out = { ...await storage.readUIPrefs() };
  if (typeof patch.contentPaneVisible === 'boolean') {
    out.contentPaneVisible = patch.contentPaneVisible;
  }
  await fs.mkdir(path.dirname(storage.getUIPrefsPath()), { recursive: true });
  await fs.writeFile(storage.getUIPrefsPath(), JSON.stringify(out), 'utf8');
  return out;
});

// ── Chat history (local JSON) ──

ipcMain.handle(REQ.CHAT_HISTORY_GET, async (_event, workspaceRoot) => {
  const store = await storage.readChatHistoryStore();
  const wsRoot = storage.normalizeWorkspaceRoot(workspaceRoot);
  const sessions = store.sessions.filter((s) => storage.sessionMatchesWorkspace(s, wsRoot));
  const activeChatId = store.activeByWorkspace[storage.workspaceBucketKey(wsRoot)] || null;
  return { sessions, activeChatId, workspaceRoot: wsRoot };
});

ipcMain.handle(REQ.CHAT_HISTORY_UPSERT, async (_event, sessionRow) => {
  const normalized = storage.normalizeSessionForStore(sessionRow);
  if (!normalized) return { ok: false };
  const store = await storage.readChatHistoryStore();
  const idx = store.sessions.findIndex((x) => x.id === normalized.id);
  if (idx >= 0) store.sessions[idx] = normalized;
  else store.sessions.push(normalized);
  store.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  if (store.sessions.length > storage.MAX_CHAT_SESSIONS) {
    const dropped = store.sessions.slice(storage.MAX_CHAT_SESSIONS);
    store.sessions = store.sessions.slice(0, storage.MAX_CHAT_SESSIONS);
    const droppedIds = new Set(dropped.map((s) => s.id));
    for (const [k, v] of Object.entries(store.activeByWorkspace)) {
      if (droppedIds.has(v)) delete store.activeByWorkspace[k];
    }
  }
  await storage.writeChatHistoryStore(store);
  return { ok: true };
});

ipcMain.handle(REQ.CHAT_HISTORY_DELETE, async (_event, id) => {
  if (typeof id !== 'string' || !id.trim()) return { ok: false };
  const store = await storage.readChatHistoryStore();
  store.sessions = store.sessions.filter((s) => s.id !== id);
  for (const [k, v] of Object.entries(store.activeByWorkspace)) {
    if (v === id) delete store.activeByWorkspace[k];
  }
  await storage.writeChatHistoryStore(store);
  return { ok: true };
});

ipcMain.handle(REQ.CHAT_HISTORY_SET_ACTIVE, async (_event, workspaceRoot, id) => {
  const store = await storage.readChatHistoryStore();
  const wsKey = storage.workspaceBucketKey(storage.normalizeWorkspaceRoot(workspaceRoot));
  if (id === null || id === undefined || id === '') {
    delete store.activeByWorkspace[wsKey];
  } else if (typeof id === 'string') {
    store.activeByWorkspace[wsKey] = id;
  }
  await storage.writeChatHistoryStore(store);
  return { ok: true };
});

// ── Chat (dispatches to active provider) ──

ipcMain.handle(REQ.CHAT_SEND, async (event, payload) => {
  const messages = payload?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { error: 'Keine Nachrichten übergeben.', code: 'INVALID' };
  }

  const config = await storage.readLLMConfig();
  const activeId = config.activeProvider || DEFAULT_PROVIDER;
  const provider = providers.getProvider(activeId);
  if (!provider) {
    return { error: `Unbekannter Provider: ${activeId}.`, code: 'INVALID' };
  }
  const providerConfig = await storage.getEffectiveProviderConfig(activeId);
  const model = providerConfig?.model || provider.defaultModel;

  if (provider.fields?.apiKey && !providerConfig?.apiKey) {
    return {
      error: `Kein API-Key für ${provider.name} hinterlegt. Bitte in den Einstellungen speichern.`,
      code: 'NO_API_KEY',
    };
  }
  if (provider.fields?.baseUrl && !providerConfig?.baseUrl) {
    return {
      error: `Keine Server-URL für ${provider.name} hinterlegt.`,
      code: 'NO_BASE_URL',
    };
  }

  const rawRoot = payload?.workspaceRoot;
  const workspaceRoot =
    typeof rawRoot === 'string' && rawRoot.trim() ? path.resolve(rawRoot.trim()) : null;

  let selectedRelPath = null;
  let selectedIsDirectory = false;
  if (workspaceRoot && typeof payload?.selectedPath === 'string' && payload.selectedPath.trim()) {
    const abs = path.resolve(payload.selectedPath.trim());
    const rel = path.relative(workspaceRoot, abs);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      selectedRelPath = rel || '.';
      selectedIsDirectory = !!payload.selectedIsDirectory;
    }
  }

  const apiMessages = [];
  if (workspaceRoot) {
    apiMessages.push({
      role: 'system',
      content: workspaceSystemPrompt(workspaceRoot, selectedRelPath, selectedIsDirectory),
    });
  }
  for (const m of messages) {
    if (m.role === 'user' || m.role === 'assistant') {
      apiMessages.push({ role: m.role, content: m.content ?? '' });
    }
  }

  const tools = workspaceRoot ? WORKSPACE_TOOLS : undefined;
  const toolTrace = [];
  const wc = event.sender;
  const callbacks = makeStreamCallbacks(wc);

  const emitToolLine = (line) => {
    if (wc && !wc.isDestroyed()) {
      wc.send(PUSH.CHAT_TOOL_LINE, { line });
    }
  };

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      emitChatProgress(wc, { type: 'phase', phase: 'waiting' });
      callbacks.reset();

      const streamed = await provider.streamChatRound({
        config: providerConfig,
        model,
        messages: apiMessages,
        tools,
        callbacks,
      });

      if (streamed.error) {
        emitChatProgress(wc, { type: 'phase', phase: 'idle' });
        return { error: streamed.error, code: streamed.code || 'API' };
      }

      const assistantMsg = streamed.message;
      if (!assistantMsg) {
        return { error: 'Ungültige Antwort der API.', code: 'INVALID' };
      }

      apiMessages.push(assistantMsg);

      const toolCalls = assistantMsg.tool_calls;
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        if (!workspaceRoot) {
          for (const tc of toolCalls) {
            const fn = tc.function;
            const toolName = fn?.name || 'tool';
            let args = {};
            try {
              args = JSON.parse(fn?.arguments || '{}');
            } catch {
              args = {};
            }
            const line = `${summarizeToolCall(toolName, args)} · kein Ordner geöffnet`;
            toolTrace.push(line);
            emitToolLine(line);
            apiMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: JSON.stringify({ error: 'Kein Arbeitsordner geöffnet; Tools nicht verfügbar.' }),
            });
          }
          continue;
        }
        for (const tc of toolCalls) {
          const fn = tc.function;
          const toolName = fn?.name;
          let args = {};
          try {
            args = JSON.parse(fn?.arguments || '{}');
          } catch {
            args = {};
          }
          const line = summarizeToolCall(toolName, args);
          toolTrace.push(line);
          emitToolLine(line);
          const out = await fsService.runWorkspaceTool(toolName, args, workspaceRoot);
          apiMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: out,
          });
        }
        continue;
      }

      emitChatProgress(wc, { type: 'phase', phase: 'idle' });
      return {
        content: assistantMsg.content ?? '',
        toolTrace,
      };
    }
    emitChatProgress(wc, { type: 'phase', phase: 'idle' });
    return { error: 'Zu viele Tool-Aufrufe in Folge.', code: 'TOOL_LIMIT' };
  } catch (err) {
    emitChatProgress(wc, { type: 'phase', phase: 'idle' });
    return { error: err.message || 'Netzwerkfehler', code: 'NETWORK' };
  }
});
