function registerSettingsHandlers({
  ipcMain,
  safeStorage,
  storage,
  providers,
  defaultProviderId,
  REQ,
}) {
  ipcMain.handle(REQ.SETTINGS_GET_LLM_STATE, async () => {
    const encryptionAvailable = safeStorage.isEncryptionAvailable();
    const config = await storage.readLLMConfig();
    const meta = providers.listProviderMeta();
    const list = meta.map((m) => {
      const entry = (config.providers && config.providers[m.id]) || {};
      const hasKey = m.fields.apiKey ? !!entry.apiKeyEnc : false;
      const baseUrl = m.fields.baseUrl ? (entry.baseUrl || m.defaultBaseUrl) : '';
      const configured = m.fields.apiKey ? hasKey : m.fields.baseUrl ? !!baseUrl : true;
      const insecureTls = m.fields.insecureTls
        ? (typeof entry.insecureTls === 'boolean' ? entry.insecureTls : m.defaultInsecureTls === true)
        : false;
      return {
        ...m,
        configured,
        hasKey,
        model: entry.model || m.defaultModel,
        baseUrl,
        insecureTls,
      };
    });
    const active = config.activeProvider || defaultProviderId;
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

    if (provider.fields?.insecureTls) {
      if (typeof payload?.insecureTls === 'boolean') {
        next.insecureTls = payload.insecureTls;
      } else if (typeof prevEntry.insecureTls !== 'boolean') {
        next.insecureTls = provider.defaultInsecureTls === true;
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
      config.activeProvider = fallback || defaultProviderId;
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
    const incomingInsecure = typeof payload?.insecureTls === 'boolean'
      ? payload.insecureTls
      : null;

    const config = {
      apiKey: incomingKey || stored.apiKey || '',
      baseUrl: incomingUrl || stored.baseUrl || provider.defaultBaseUrl || '',
      insecureTls: incomingInsecure !== null
        ? incomingInsecure
        : (typeof stored.insecureTls === 'boolean'
            ? stored.insecureTls
            : provider.defaultInsecureTls === true),
    };
    try {
      return await provider.listModels(config);
    } catch (err) {
      return { error: err.message || 'Modelle konnten nicht geladen werden.' };
    }
  });

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
    const out = { ...(await storage.readUIPrefs()) };
    if (typeof patch.contentPaneVisible === 'boolean') {
      out.contentPaneVisible = patch.contentPaneVisible;
    }
    await storage.writeUIPrefs(out);
    return out;
  });
}

module.exports = { registerSettingsHandlers };
