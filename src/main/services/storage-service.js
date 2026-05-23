const { randomUUID } = require('crypto');

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

  const fileLocks = new Map();

  async function writeJsonAtomic(targetPath, data) {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const tmp = `${targetPath}.tmp-${randomUUID()}`;
    await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
    try {
      await fs.rename(tmp, targetPath);
    } catch (err) {
      await fs.unlink(tmp).catch(() => {});
      throw err;
    }
  }

  function withFileLock(targetPath, fn) {
    const prev = fileLocks.get(targetPath) || Promise.resolve();
    const task = prev.then(fn, fn);
    fileLocks.set(targetPath, task.catch(() => {}));
    return task;
  }

  function withChatHistoryLock(fn) {
    return withFileLock(getChatHistoryPath(), fn);
  }

  function getLLMConfigPath() {
    return path.join(app.getPath('userData'), LLM_CONFIG_FILENAME);
  }

  function getLegacyOpenAIConfigPath() {
    return path.join(app.getPath('userData'), LEGACY_OPENAI_CONFIG_FILENAME);
  }

  function defaultLLMConfig() {
    return {
      version: 3,
      activeProvider: DEFAULT_PROVIDER,
      activePresetId: null,
      presets: [],
      providers: {},
    };
  }

  function normalizePresetEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : null;
    const providerId = typeof raw.providerId === 'string' && raw.providerId.trim()
      ? raw.providerId.trim()
      : null;
    if (!id || !providerId || !providers.getProvider(providerId)) return null;
    let model =
      typeof raw.model === 'string' && raw.model.trim()
        ? raw.model.trim()
        : providers.getProvider(providerId).defaultModel;
    const menuVisible = raw.menuVisible !== false;
    let reasoningEffort = null;
    if (
      providerId === 'openai'
      && typeof raw.reasoningEffort === 'string'
      && raw.reasoningEffort.trim()
    ) {
      reasoningEffort = raw.reasoningEffort.trim();
    }
    return { id, providerId, model, reasoningEffort, menuVisible };
  }

  /** Chat-Ziel aus LLM-Konfiguration (Preset-first, Fallback aktiv/Provider-Modell). */
  function resolveChatModelTarget(llmConfig) {
    const list = Array.isArray(llmConfig.presets) ? llmConfig.presets : [];
    const preset = list.find((p) => p && p.id === llmConfig.activePresetId);
    if (preset && providers.getProvider(preset.providerId)) {
      const pMeta = providers.getProvider(preset.providerId);
      return {
        providerId: preset.providerId,
        model: typeof preset.model === 'string' && preset.model.trim()
          ? preset.model.trim()
          : pMeta.defaultModel,
        reasoningEffort: preset.reasoningEffort || null,
      };
    }
    const ap = llmConfig.activeProvider || DEFAULT_PROVIDER;
    const pMeta = providers.getProvider(ap);
    const entry = (llmConfig.providers && llmConfig.providers[ap]) || {};
    return {
      providerId: ap,
      model:
        typeof entry.model === 'string' && entry.model.trim()
          ? entry.model.trim()
          : (pMeta && pMeta.defaultModel) || '',
      reasoningEffort: null,
    };
  }

  async function migrateLLMConfigToV3(existing, { persist = true } = {}) {
    const out = { ...existing };
    out.version = 3;
    if (!Array.isArray(out.presets)) out.presets = [];
    if (
      (!out.presets || out.presets.length === 0)
      && typeof out.activeProvider === 'string'
      && providers.getProvider(out.activeProvider)
    ) {
      const ap = out.activeProvider;
      const pMeta = providers.getProvider(ap);
      const entry = (out.providers && out.providers[ap]) || {};
      const model =
        typeof entry.model === 'string' && entry.model.trim()
          ? entry.model.trim()
          : pMeta.defaultModel;
      const id = randomUUID();
      out.presets = [
        {
          id,
          providerId: ap,
          model,
          reasoningEffort: null,
          menuVisible: true,
        },
      ];
      out.activePresetId = id;
    }
    if (out.presets.length > 0) {
      if (!out.activePresetId || !out.presets.some((p) => p && p.id === out.activePresetId)) {
        out.activePresetId = out.presets[0].id;
      }
      const cur = resolveChatModelTarget(out);
      out.activeProvider = cur.providerId;
    }
    if (persist) {
      await writeLLMConfig(out);
    }
    return out;
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

  async function readLLMConfig({ persistMigration = true } = {}) {
    const existing = await readLLMConfigRaw();
    if (existing && existing.version === 3 && existing.providers) {
      if (!existing.providers || typeof existing.providers !== 'object') {
        existing.providers = {};
      }
      if (!existing.activeProvider) existing.activeProvider = DEFAULT_PROVIDER;
      if (!Array.isArray(existing.presets)) existing.presets = [];
      return existing;
    }
    if (existing && existing.version === 2 && existing.providers) {
      if (!existing.providers || typeof existing.providers !== 'object') {
        existing.providers = {};
      }
      if (!existing.activeProvider) existing.activeProvider = DEFAULT_PROVIDER;
      return migrateLLMConfigToV3(existing, { persist: persistMigration });
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
    const withV3 = await migrateLLMConfigToV3(migrated, { persist: persistMigration });
    return withV3;
  }

  async function writeLLMConfig(config) {
    await withFileLock(getLLMConfigPath(), () => writeJsonAtomic(getLLMConfigPath(), config));
  }

  async function updateLLMConfig(updater) {
    return withFileLock(getLLMConfigPath(), async () => {
      const config = await readLLMConfig({ persistMigration: false });
      const updated = await updater(config);
      await writeJsonAtomic(getLLMConfigPath(), updated);
      return updated;
    });
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

  function encryptIfPossible(plaintext) {
    if (!plaintext || !safeStorage.isEncryptionAvailable()) return null;
    try {
      return safeStorage.encryptString(plaintext).toString('base64');
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
    if (provider.fields?.insecureTls) {
      // typeof check, damit ein bewusst gesetztes "false" nicht still auf
      // den Default zurueckfaellt.
      out.insecureTls = typeof entry.insecureTls === 'boolean'
        ? entry.insecureTls
        : (provider.defaultInsecureTls === true);
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

  const SIDEBAR_WIDTH_MIN = 150;
  const SIDEBAR_WIDTH_MAX = 600;
  const CHAT_PANEL_WIDTH_MIN = 260;
  const CHAT_PANEL_WIDTH_MAX = 2000;

  function clampSidebarWidth(raw) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
    return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(raw)));
  }

  function clampChatPanelWidth(raw) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
    return Math.min(CHAT_PANEL_WIDTH_MAX, Math.max(CHAT_PANEL_WIDTH_MIN, Math.round(raw)));
  }

  function getUIPrefsPath() {
    return path.join(app.getPath('userData'), UI_PREFS_FILENAME);
  }

  async function readUIPrefs() {
    try {
      const raw = await fs.readFile(getUIPrefsPath(), 'utf8');
      const data = JSON.parse(raw);
      let baseSystemPrompt = '';
      if (typeof data.baseSystemPrompt === 'string') {
        baseSystemPrompt = data.baseSystemPrompt;
      }
      const appLocale = data.appLocale === 'en' ? 'en' : 'de';
      let maxToolRounds;
      if (typeof data.maxToolRounds === 'number' && Number.isFinite(data.maxToolRounds)) {
        maxToolRounds = Math.round(data.maxToolRounds);
      }
      const sidebarWidth = clampSidebarWidth(data.sidebarWidth);
      const chatPanelWidth = clampChatPanelWidth(data.chatPanelWidth);
      return {
        contentPaneVisible: data.contentPaneVisible !== false,
        baseSystemPrompt,
        appLocale,
        ...(typeof maxToolRounds === 'number' ? { maxToolRounds } : {}),
        ...(typeof sidebarWidth === 'number' ? { sidebarWidth } : {}),
        ...(typeof chatPanelWidth === 'number' ? { chatPanelWidth } : {}),
      };
    } catch {
      return { contentPaneVisible: true, baseSystemPrompt: '', appLocale: 'de' };
    }
  }

  async function writeUIPrefs(data) {
    await withFileLock(getUIPrefsPath(), () => writeJsonAtomic(getUIPrefsPath(), data));
  }

  async function updateUIPrefs(updater) {
    return withFileLock(getUIPrefsPath(), async () => {
      const current = await readUIPrefs();
      const updated = await updater({ ...current });
      await writeJsonAtomic(getUIPrefsPath(), updated);
      return updated;
    });
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

  function parseChatHistoryStoreData(data) {
    if (!data || typeof data !== 'object') return null;
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
  }

  async function loadChatHistoryStoreFromDisk() {
    try {
      const raw = await fs.readFile(getChatHistoryPath(), 'utf8');
      let data = JSON.parse(raw);
      if (!data || typeof data !== 'object') {
        return { store: defaultChatHistoryStore(), wasEncrypted: false };
      }

      let wasEncrypted = false;
      if (data.encrypted === true && typeof data.payload === 'string') {
        wasEncrypted = true;
        const decrypted = decryptIfPossible(data.payload);
        if (!decrypted) return { store: defaultChatHistoryStore(), wasEncrypted: true };
        try {
          data = JSON.parse(decrypted);
        } catch {
          return { store: defaultChatHistoryStore(), wasEncrypted: true };
        }
      }

      const store = parseChatHistoryStoreData(data);
      if (!store) return { store: defaultChatHistoryStore(), wasEncrypted };
      return { store, wasEncrypted };
    } catch {
      return { store: defaultChatHistoryStore(), wasEncrypted: false };
    }
  }

  async function migrateChatHistoryToEncryptedIfNeeded(store, wasEncrypted) {
    if (safeStorage.isEncryptionAvailable() && !wasEncrypted) {
      await writeChatHistoryStore(store);
    }
  }

  async function readChatHistoryStore({ skipMigration = false } = {}) {
    const { store, wasEncrypted } = await loadChatHistoryStoreFromDisk();
    if (skipMigration) return store;
    if (safeStorage.isEncryptionAvailable() && !wasEncrypted) {
      return withChatHistoryLock(async () => {
        const fresh = await loadChatHistoryStoreFromDisk();
        await migrateChatHistoryToEncryptedIfNeeded(fresh.store, fresh.wasEncrypted);
        return fresh.store;
      });
    }
    return store;
  }

  async function writeChatHistoryStore(store) {
    if (safeStorage.isEncryptionAvailable()) {
      const payload = encryptIfPossible(JSON.stringify(store));
      if (payload) {
        await writeJsonAtomic(getChatHistoryPath(), { encrypted: true, payload });
        return;
      }
    }
    await writeJsonAtomic(getChatHistoryPath(), store);
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
    await writeJsonAtomic(getLastFolderConfigPath(), { path: resolved });
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
    await writeJsonAtomic(getFolderHistoryPath(), { paths });
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
    updateLLMConfig,
    resolveChatModelTarget,
    normalizePresetEntry,
    migrateLLMConfigToV3,
    getEffectiveProviderConfig,
    getOpenAIApiKey,
    getValidatedLastFolder,
    clampSidebarWidth,
    clampChatPanelWidth,
    readUIPrefs,
    writeUIPrefs,
    updateUIPrefs,
    normalizeWorkspaceRoot,
    workspaceBucketKey,
    normalizeSessionForStore,
    readChatHistoryStore,
    writeChatHistoryStore,
    withChatHistoryLock,
    persistLastFolder,
    getValidatedFolderHistory,
    sessionMatchesWorkspace,
  };
}

module.exports = {
  createStorageService,
};
