const { app, ipcMain, dialog, safeStorage, session } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const providers = require('./providers');
const { createWindow, getMainWindow } = require('./src/main/window');
const { REQUEST_CHANNELS: REQ, PUSH_CHANNELS: PUSH } = require('./src/shared/ipc-channels');

const LLM_CONFIG_FILENAME = 'llm-config.json';
const LEGACY_OPENAI_CONFIG_FILENAME = 'openai-config.json';
const LAST_FOLDER_FILENAME = 'last-folder.json';
const FOLDER_HISTORY_FILENAME = 'folder-history.json';
const UI_PREFS_FILENAME = 'ui-preferences.json';
const CHAT_HISTORY_FILENAME = 'chat-history.json';
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

function resolveWorkspacePath(workspaceRoot, relativePath) {
  const root = path.resolve(workspaceRoot);
  const raw = typeof relativePath === 'string' ? relativePath.trim() : '';
  const joined = path.resolve(root, raw.length ? raw : '.');
  const rel = path.relative(root, joined);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { error: 'Pfad liegt außerhalb des Arbeitsordners.' };
  }
  return { absPath: joined };
}

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

async function runWorkspaceTool(toolName, args, workspaceRoot) {
  if (toolName === 'list_directory') {
    const relArg = args.relative_path;
    const rel = typeof relArg === 'string' ? relArg : '';
    const { absPath, error } = resolveWorkspacePath(workspaceRoot, rel);
    if (error) return JSON.stringify({ error });
    try {
      const st = await fs.stat(absPath);
      if (!st.isDirectory()) {
        return JSON.stringify({ error: 'Pfad ist kein Ordner.' });
      }
      const entries = await fs.readdir(absPath, { withFileTypes: true });
      const items = entries
        .filter((e) => !e.name.startsWith('.'))
        .map((e) => ({
          name: e.name,
          kind: e.isDirectory() ? 'directory' : 'file',
        }))
        .sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
        });
      return JSON.stringify({ relative_path: rel || '.', items });
    } catch (e) {
      return JSON.stringify({ error: e.message });
    }
  }

  if (toolName === 'read_file_text') {
    const rel = typeof args.relative_path === 'string' ? args.relative_path.trim() : '';
    if (!rel) {
      return JSON.stringify({ error: 'relative_path ist erforderlich.' });
    }
    let maxChars = Number.isFinite(args.max_characters) ? Math.floor(args.max_characters) : 32000;
    maxChars = Math.min(Math.max(1000, maxChars), 200000);
    const { absPath, error } = resolveWorkspacePath(workspaceRoot, rel);
    if (error) return JSON.stringify({ error });
    try {
      const st = await fs.stat(absPath);
      if (st.isDirectory()) {
        return JSON.stringify({ error: 'Pfad ist ein Ordner, keine Datei.' });
      }
      if (st.size > MAX_READ_FILE_BYTES) {
        return JSON.stringify({
          error: `Datei zu groß (>${MAX_READ_FILE_BYTES} Bytes). Bitte andere Datei wählen.`,
        });
      }
      const buf = await fs.readFile(absPath);
      let text = buf.toString('utf8');
      const truncated = text.length > maxChars;
      if (truncated) {
        text = `${text.slice(0, maxChars)}\n… [gekürzt auf ${maxChars} Zeichen]`;
      }
      return JSON.stringify({
        relative_path: rel,
        size_bytes: st.size,
        truncated,
        content: text,
      });
    } catch (e) {
      return JSON.stringify({ error: e.message });
    }
  }

  return JSON.stringify({ error: `Unbekanntes Tool: ${toolName}` });
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

// ── LLM config (multi-provider) ──

function getLLMConfigPath() {
  return path.join(app.getPath('userData'), LLM_CONFIG_FILENAME);
}

function getLegacyOpenAIConfigPath() {
  return path.join(app.getPath('userData'), LEGACY_OPENAI_CONFIG_FILENAME);
}

function defaultLLMConfig() {
  return { version: 2, activeProvider: DEFAULT_PROVIDER, providers: {} };
}

async function readLLMConfigRaw() {
  try {
    const raw = await fs.readFile(getLLMConfigPath(), 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}

async function readLegacyOpenAIConfig() {
  try {
    const raw = await fs.readFile(getLegacyOpenAIConfigPath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readLLMConfig() {
  const existing = await readLLMConfigRaw();
  if (existing && existing.version === 2 && existing.providers) {
    if (!existing.providers || typeof existing.providers !== 'object') {
      existing.providers = {};
    }
    if (!existing.activeProvider) existing.activeProvider = DEFAULT_PROVIDER;
    return existing;
  }
  // Migrate from legacy openai-config.json (if present)
  const legacy = await readLegacyOpenAIConfig();
  const migrated = defaultLLMConfig();
  if (legacy && legacy.apiKeyEnc) {
    migrated.providers.openai = {
      apiKeyEnc: legacy.apiKeyEnc,
      model: legacy.model || providers.getProvider('openai').defaultModel,
    };
    migrated.activeProvider = 'openai';
  }
  await writeLLMConfig(migrated);
  return migrated;
}

async function writeLLMConfig(config) {
  await fs.mkdir(path.dirname(getLLMConfigPath()), { recursive: true });
  await fs.writeFile(getLLMConfigPath(), JSON.stringify(config), 'utf8');
}

function decryptIfPossible(b64) {
  if (!b64) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(b64, 'base64'));
  } catch {
    return null;
  }
}

async function getEffectiveProviderConfig(providerId) {
  const provider = providers.getProvider(providerId);
  if (!provider) return null;
  const config = await readLLMConfig();
  const entry = (config.providers && config.providers[providerId]) || {};
  const out = { model: entry.model || provider.defaultModel };
  if (provider.fields?.apiKey && entry.apiKeyEnc) {
    const k = decryptIfPossible(entry.apiKeyEnc);
    if (k) out.apiKey = k;
  }
  if (provider.fields?.baseUrl) {
    out.baseUrl = entry.baseUrl || provider.defaultBaseUrl || '';
  }
  return out;
}

async function getOpenAIApiKey() {
  const cfg = await getEffectiveProviderConfig('openai');
  return cfg?.apiKey || null;
}

// ── Last folder, folder history, UI prefs, chat history ──

function getLastFolderConfigPath() {
  return path.join(app.getPath('userData'), LAST_FOLDER_FILENAME);
}

async function readLastFolderRaw() {
  try {
    const raw = await fs.readFile(getLastFolderConfigPath(), 'utf8');
    const data = JSON.parse(raw);
    return typeof data.path === 'string' ? data.path : null;
  } catch {
    return null;
  }
}

async function clearLastFolderFile() {
  try {
    await fs.unlink(getLastFolderConfigPath());
  } catch {
    /* ignore */
  }
}

async function getValidatedLastFolder() {
  const p = await readLastFolderRaw();
  if (!p || !p.trim()) return null;
  const resolved = path.resolve(p.trim());
  try {
    const st = await fs.stat(resolved);
    if (!st.isDirectory()) {
      await clearLastFolderFile();
      return null;
    }
    return resolved;
  } catch {
    await clearLastFolderFile();
    return null;
  }
}

function getUIPrefsPath() {
  return path.join(app.getPath('userData'), UI_PREFS_FILENAME);
}

async function readUIPrefs() {
  try {
    const raw = await fs.readFile(getUIPrefsPath(), 'utf8');
    const data = JSON.parse(raw);
    return {
      contentPaneVisible: data.contentPaneVisible !== false,
    };
  } catch {
    return { contentPaneVisible: true };
  }
}

function getChatHistoryPath() {
  return path.join(app.getPath('userData'), CHAT_HISTORY_FILENAME);
}

const NO_WORKSPACE_KEY = '__none__';

function defaultChatHistoryStore() {
  return { version: 2, activeByWorkspace: {}, sessions: [] };
}

function normalizeWorkspaceRoot(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return path.resolve(trimmed);
}

function workspaceBucketKey(workspaceRoot) {
  return workspaceRoot ? workspaceRoot : NO_WORKSPACE_KEY;
}

function sanitizeChatMessagesForStore(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const content = typeof m.content === 'string' ? m.content : '';
    if (m.role === 'user') {
      out.push({ role: 'user', content });
      continue;
    }
    const row = { role: 'assistant', content };
    if (m.isError === true) row.isError = true;
    if (Array.isArray(m.toolTrace) && m.toolTrace.length) row.toolTrace = m.toolTrace;
    if (typeof m.reasoningText === 'string' && m.reasoningText.trim()) {
      row.reasoningText = m.reasoningText;
    }
    out.push(row);
  }
  return out;
}

function normalizeSessionForStore(s) {
  if (!s || typeof s.id !== 'string' || !s.id.trim()) return null;
  const messages = sanitizeChatMessagesForStore(s.messages);
  const titleRaw = typeof s.title === 'string' ? s.title.trim() : '';
  const workspaceRoot = normalizeWorkspaceRoot(s.workspaceRoot);
  return {
    id: s.id.trim(),
    workspaceRoot,
    title: titleRaw ? titleRaw.slice(0, 200) : 'Chat',
    updatedAt: Number.isFinite(s.updatedAt) ? s.updatedAt : Date.now(),
    messages,
  };
}

async function readChatHistoryStore() {
  try {
    const raw = await fs.readFile(getChatHistoryPath(), 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return defaultChatHistoryStore();
    const sessionsIn = Array.isArray(data.sessions) ? data.sessions : [];
    const sessions = sessionsIn
      .map((x) => normalizeSessionForStore(x))
      .filter(Boolean);

    const activeByWorkspace = {};
    if (data.activeByWorkspace && typeof data.activeByWorkspace === 'object') {
      for (const [k, v] of Object.entries(data.activeByWorkspace)) {
        if (typeof k === 'string' && k && typeof v === 'string' && v) {
          activeByWorkspace[k] = v;
        }
      }
    } else if (typeof data.activeChatId === 'string' && data.activeChatId) {
      activeByWorkspace[NO_WORKSPACE_KEY] = data.activeChatId;
    }

    return {
      version: 2,
      activeByWorkspace,
      sessions,
    };
  } catch {
    return defaultChatHistoryStore();
  }
}

async function writeChatHistoryStore(store) {
  await fs.mkdir(path.dirname(getChatHistoryPath()), { recursive: true });
  await fs.writeFile(getChatHistoryPath(), JSON.stringify(store), 'utf8');
}

async function persistLastFolder(folderPath) {
  const raw = typeof folderPath === 'string' ? folderPath.trim() : '';
  if (!raw) return;
  const resolved = path.resolve(raw);
  try {
    const st = await fs.stat(resolved);
    if (!st.isDirectory()) return;
  } catch {
    return;
  }
  await fs.mkdir(path.dirname(getLastFolderConfigPath()), { recursive: true });
  await fs.writeFile(getLastFolderConfigPath(), JSON.stringify({ path: resolved }), 'utf8');
  await addFolderToHistory(resolved);
}

function getFolderHistoryPath() {
  return path.join(app.getPath('userData'), FOLDER_HISTORY_FILENAME);
}

async function readFolderHistoryRaw() {
  try {
    const raw = await fs.readFile(getFolderHistoryPath(), 'utf8');
    const data = JSON.parse(raw);
    if (Array.isArray(data?.paths)) {
      return data.paths.filter((p) => typeof p === 'string' && p.trim());
    }
    return [];
  } catch {
    return [];
  }
}

async function writeFolderHistory(paths) {
  await fs.mkdir(path.dirname(getFolderHistoryPath()), { recursive: true });
  await fs.writeFile(getFolderHistoryPath(), JSON.stringify({ paths }), 'utf8');
}

async function addFolderToHistory(resolvedPath) {
  const list = await readFolderHistoryRaw();
  const filtered = list.filter((p) => p !== resolvedPath);
  filtered.unshift(resolvedPath);
  const trimmed = filtered.slice(0, MAX_FOLDER_HISTORY);
  await writeFolderHistory(trimmed);
}

async function getValidatedFolderHistory() {
  const list = await readFolderHistoryRaw();
  const out = [];
  let changed = false;
  for (const p of list) {
    try {
      const st = await fs.stat(p);
      if (st.isDirectory()) {
        out.push(p);
      } else {
        changed = true;
      }
    } catch {
      changed = true;
    }
  }
  if (changed) await writeFolderHistory(out);
  return out;
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'audioCapture') {
      callback(true);
      return;
    }
    callback(false);
  });

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
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const items = await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith('.'))
        .map(async (entry) => {
          const fullPath = path.join(dirPath, entry.name);
          let stats = null;
          try {
            stats = await fs.stat(fullPath);
          } catch {
            // skip inaccessible files
          }
          return {
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size: stats ? stats.size : 0,
            modified: stats ? stats.mtimeMs : 0,
          };
        })
    );

    items.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return items;
  } catch (err) {
    console.error('readDirectory error:', err.message);
    return [];
  }
});

ipcMain.handle(REQ.FS_MOVE_ITEM, async (_event, sourcePath, destDir) => {
  try {
    const srcStat = await fs.stat(sourcePath);
    const dstStat = await fs.stat(destDir);
    if (!dstStat.isDirectory()) {
      return { error: 'Ziel ist kein Ordner.' };
    }
    const baseName = path.basename(sourcePath);
    let targetPath = path.join(destDir, baseName);

    const srcParent = path.dirname(sourcePath);
    if (path.resolve(srcParent) === path.resolve(destDir)) {
      return { error: 'Quelle liegt bereits in diesem Ordner.' };
    }

    if (srcStat.isDirectory() && path.resolve(destDir).startsWith(path.resolve(sourcePath) + path.sep)) {
      return { error: 'Ordner kann nicht in sich selbst verschoben werden.' };
    }

    try {
      await fs.access(targetPath);
      const ext = path.extname(baseName);
      const nameNoExt = ext ? baseName.slice(0, -ext.length) : baseName;
      let i = 2;
      do {
        targetPath = path.join(destDir, `${nameNoExt} (${i})${ext}`);
        i++;
        try { await fs.access(targetPath); } catch { break; }
      } while (true);
    } catch {
      // target does not exist – good
    }

    await fs.rename(sourcePath, targetPath);
    return { ok: true, newPath: targetPath };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(REQ.FS_READ_FILE, async (_event, filePath) => {
  try {
    const stats = await fs.stat(filePath);
    const MAX_SIZE = 1024 * 1024; // 1 MB limit for preview
    if (stats.size > MAX_SIZE) {
      return { error: 'File too large for preview', size: stats.size };
    }
    const content = await fs.readFile(filePath, 'utf-8');
    return { content, size: stats.size, modified: stats.mtimeMs };
  } catch (err) {
    return { error: err.message };
  }
});

// ── Whisper speech-to-text (uses OpenAI provider key) ──

ipcMain.handle(REQ.WHISPER_TRANSCRIBE, async (_event, audioBuffer) => {
  const apiKey = await getOpenAIApiKey();
  if (!apiKey) return { error: 'Kein OpenAI-Key hinterlegt (Whisper benötigt einen).' };

  const boundary = `----ElectronWhisper${Date.now()}`;
  const fileName = 'voice.webm';

  const fieldParts = [];
  fieldParts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
  );
  fieldParts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nde\r\n`
  );
  fieldParts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\njson\r\n`
  );
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: audio/webm\r\n\r\n`
  );
  const fileFooter = Buffer.from(`\r\n--${boundary}--\r\n`);
  const textParts = Buffer.from(fieldParts.join(''));
  const fileBuf = Buffer.from(audioBuffer);
  const body = Buffer.concat([textParts, fileHeader, fileBuf, fileFooter]);

  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      let msg = res.statusText;
      try {
        const j = JSON.parse(errText);
        msg = j.error?.message || msg;
      } catch { /* ignore */ }
      return { error: msg };
    }
    const json = await res.json();
    return { text: json.text || '' };
  } catch (err) {
    return { error: err.message || 'Transkription fehlgeschlagen.' };
  }
});

// ── LLM provider settings ──

ipcMain.handle(REQ.SETTINGS_GET_LLM_STATE, async () => {
  const encryptionAvailable = safeStorage.isEncryptionAvailable();
  const config = await readLLMConfig();
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

  const config = await readLLMConfig();
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
  await writeLLMConfig(config);
  return { ok: true };
});

ipcMain.handle(REQ.SETTINGS_CLEAR_PROVIDER, async (_event, providerId) => {
  if (!providers.getProvider(providerId)) return { ok: false, error: 'Unbekannter Provider.' };
  const config = await readLLMConfig();
  if (config.providers) delete config.providers[providerId];
  if (config.activeProvider === providerId) {
    const fallback = providers.PROVIDER_ORDER.find(
      (id) => config.providers && config.providers[id]
    );
    config.activeProvider = fallback || DEFAULT_PROVIDER;
  }
  await writeLLMConfig(config);
  return { ok: true };
});

ipcMain.handle(REQ.SETTINGS_SET_ACTIVE_PROVIDER, async (_event, providerId) => {
  if (!providers.getProvider(providerId)) {
    return { ok: false, error: 'Unbekannter Provider.' };
  }
  const config = await readLLMConfig();
  config.activeProvider = providerId;
  await writeLLMConfig(config);
  return { ok: true };
});

ipcMain.handle(REQ.SETTINGS_LIST_MODELS, async (_event, payload) => {
  const providerId = payload?.providerId;
  const provider = providers.getProvider(providerId);
  if (!provider) return { error: 'Unbekannter Provider.' };

  const stored = (await getEffectiveProviderConfig(providerId)) || {};
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
  const folderPath = await getValidatedLastFolder();
  return { folderPath };
});

ipcMain.handle(REQ.SETTINGS_SET_LAST_FOLDER, async (_event, folderPath) => {
  await persistLastFolder(folderPath);
  return { ok: true };
});

ipcMain.handle(REQ.SETTINGS_GET_FOLDER_HISTORY, async () => {
  const paths = await getValidatedFolderHistory();
  return { paths };
});

ipcMain.handle(REQ.SETTINGS_GET_UI_PREFS, async () => readUIPrefs());

ipcMain.handle(REQ.SETTINGS_SET_UI_PREFS, async (_event, partial) => {
  const patch = partial && typeof partial === 'object' ? partial : {};
  const out = { ...await readUIPrefs() };
  if (typeof patch.contentPaneVisible === 'boolean') {
    out.contentPaneVisible = patch.contentPaneVisible;
  }
  await fs.mkdir(path.dirname(getUIPrefsPath()), { recursive: true });
  await fs.writeFile(getUIPrefsPath(), JSON.stringify(out), 'utf8');
  return out;
});

// ── Chat history (local JSON) ──

function sessionMatchesWorkspace(session, workspaceRoot) {
  const sessionWs = session.workspaceRoot || null;
  return sessionWs === (workspaceRoot || null);
}

ipcMain.handle(REQ.CHAT_HISTORY_GET, async (_event, workspaceRoot) => {
  const store = await readChatHistoryStore();
  const wsRoot = normalizeWorkspaceRoot(workspaceRoot);
  const sessions = store.sessions.filter((s) => sessionMatchesWorkspace(s, wsRoot));
  const activeChatId = store.activeByWorkspace[workspaceBucketKey(wsRoot)] || null;
  return { sessions, activeChatId, workspaceRoot: wsRoot };
});

ipcMain.handle(REQ.CHAT_HISTORY_UPSERT, async (_event, session) => {
  const normalized = normalizeSessionForStore(session);
  if (!normalized) return { ok: false };
  const store = await readChatHistoryStore();
  const idx = store.sessions.findIndex((x) => x.id === normalized.id);
  if (idx >= 0) store.sessions[idx] = normalized;
  else store.sessions.push(normalized);
  store.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  if (store.sessions.length > MAX_CHAT_SESSIONS) {
    const dropped = store.sessions.slice(MAX_CHAT_SESSIONS);
    store.sessions = store.sessions.slice(0, MAX_CHAT_SESSIONS);
    const droppedIds = new Set(dropped.map((s) => s.id));
    for (const [k, v] of Object.entries(store.activeByWorkspace)) {
      if (droppedIds.has(v)) delete store.activeByWorkspace[k];
    }
  }
  await writeChatHistoryStore(store);
  return { ok: true };
});

ipcMain.handle(REQ.CHAT_HISTORY_DELETE, async (_event, id) => {
  if (typeof id !== 'string' || !id.trim()) return { ok: false };
  const store = await readChatHistoryStore();
  store.sessions = store.sessions.filter((s) => s.id !== id);
  for (const [k, v] of Object.entries(store.activeByWorkspace)) {
    if (v === id) delete store.activeByWorkspace[k];
  }
  await writeChatHistoryStore(store);
  return { ok: true };
});

ipcMain.handle(REQ.CHAT_HISTORY_SET_ACTIVE, async (_event, workspaceRoot, id) => {
  const store = await readChatHistoryStore();
  const wsKey = workspaceBucketKey(normalizeWorkspaceRoot(workspaceRoot));
  if (id === null || id === undefined || id === '') {
    delete store.activeByWorkspace[wsKey];
  } else if (typeof id === 'string') {
    store.activeByWorkspace[wsKey] = id;
  }
  await writeChatHistoryStore(store);
  return { ok: true };
});

// ── Chat (dispatches to active provider) ──

ipcMain.handle(REQ.CHAT_SEND, async (event, payload) => {
  const messages = payload?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { error: 'Keine Nachrichten übergeben.', code: 'INVALID' };
  }

  const config = await readLLMConfig();
  const activeId = config.activeProvider || DEFAULT_PROVIDER;
  const provider = providers.getProvider(activeId);
  if (!provider) {
    return { error: `Unbekannter Provider: ${activeId}.`, code: 'INVALID' };
  }
  const providerConfig = await getEffectiveProviderConfig(activeId);
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
          const out = await runWorkspaceTool(toolName, args, workspaceRoot);
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
