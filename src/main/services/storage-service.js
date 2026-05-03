function createStorageService({
  app,
  safeStorage,
  fs,
  path,
  providers,
  maxChatSessions,
  maxFolderHistory,
  defaultProviderId,
}) {
  const LLM_CONFIG_FILENAME = 'llm-config.json';
  const LEGACY_OPENAI_CONFIG_FILENAME = 'openai-config.json';
  const LAST_FOLDER_FILENAME = 'last-folder.json';
  const FOLDER_HISTORY_FILENAME = 'folder-history.json';
  const UI_PREFS_FILENAME = 'ui-preferences.json';
  const CHAT_HISTORY_FILENAME = 'chat-history.json';

  const MAX_CHAT_SESSIONS = maxChatSessions;
  const MAX_FOLDER_HISTORY = maxFolderHistory;
  const DEFAULT_PROVIDER = defaultProviderId;

  const NO_WORKSPACE_KEY = '__none__';

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

  function sessionMatchesWorkspace(sessionRow, workspaceRoot) {
    const sessionWs = sessionRow.workspaceRoot || null;
    return sessionWs === (workspaceRoot || null);
  }

  return {
    MAX_CHAT_SESSIONS,
    getUIPrefsPath,
    readLLMConfig,
    writeLLMConfig,
    getEffectiveProviderConfig,
    getOpenAIApiKey,
    getValidatedLastFolder,
    readUIPrefs,
    normalizeWorkspaceRoot,
    workspaceBucketKey,
    normalizeSessionForStore,
    readChatHistoryStore,
    writeChatHistoryStore,
    persistLastFolder,
    getValidatedFolderHistory,
    sessionMatchesWorkspace,
  };
}

module.exports = {
  createStorageService,
};
