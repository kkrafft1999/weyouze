function registerSettingsHandlers({
  ipcMain,
  safeStorage,
  storage,
  providers,
  defaultProviderId,
  REQ,
  setActiveWorkspaceRoot,
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
    const chatTarget = storage.resolveChatModelTarget(config);
    const active = config.activeProvider || defaultProviderId;
    const presets = Array.isArray(config.presets)
      ? config.presets.map((row) => storage.normalizePresetEntry(row)).filter(Boolean)
      : [];
    return {
      encryptionAvailable,
      activeProvider: active,
      activePresetId: config.activePresetId || null,
      presets,
      chatTarget,
      providers: list,
    };
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

  ipcMain.handle(REQ.SETTINGS_SET_ACTIVE_PROVIDER, async (_event, providerId) => {
    if (!providers.getProvider(providerId)) {
      return { ok: false, error: 'Unbekannter Provider.' };
    }
    const config = await storage.readLLMConfig();
    config.activeProvider = providerId;
    await storage.writeLLMConfig(config);
    return { ok: true };
  });

  function mergeProviderPatchIntoConfig(config, providerId, patch) {
    const provider = providers.getProvider(providerId);
    if (!provider) return { ok: false, error: 'Unbekannter Provider.' };
    const prevEntry = (config.providers && config.providers[providerId]) || {};
    const next = { ...prevEntry };

    if (provider.fields?.apiKey) {
      const incomingKey = typeof patch?.apiKey === 'string' ? patch.apiKey.trim() : '';
      if (incomingKey) {
        if (!safeStorage.isEncryptionAvailable()) {
          return { ok: false, error: 'Verschlüsselter Speicher ist nicht verfügbar.' };
        }
        next.apiKeyEnc = safeStorage.encryptString(incomingKey).toString('base64');
      }
    }

    if (provider.fields?.baseUrl && typeof patch?.baseUrl === 'string' && patch.baseUrl.trim()) {
      next.baseUrl = patch.baseUrl.trim();
    }

    if (provider.fields?.insecureTls && typeof patch?.insecureTls === 'boolean') {
      next.insecureTls = patch.insecureTls;
    }

    config.providers = config.providers || {};
    config.providers[providerId] = next;
    return { ok: true };
  }

  ipcMain.handle(REQ.SETTINGS_SET_ACTIVE_PRESET, async (_event, presetId) => {
    if (typeof presetId !== 'string' || !presetId.trim()) {
      return { ok: false, error: 'Kein Eintrag gewählt.' };
    }
    const config = await storage.readLLMConfig();
    const preset = Array.isArray(config.presets)
      ? config.presets.find((p) => p && p.id === presetId.trim())
      : null;
    if (!preset || !providers.getProvider(preset.providerId)) {
      return { ok: false, error: 'Eintrag nicht gefunden.' };
    }
    const meta = providers.getProvider(preset.providerId);
    const entry = (config.providers && config.providers[preset.providerId]) || {};
    const configured = meta.fields?.apiKey
      ? !!entry.apiKeyEnc
      : meta.fields?.baseUrl
        ? !!(entry.baseUrl || meta.defaultBaseUrl)
        : true;
    if (!configured) {
      return { ok: false, error: 'Anbieter ist noch nicht konfiguriert.' };
    }
    config.activePresetId = presetId.trim();
    config.activeProvider = preset.providerId;
    config.providers = config.providers || {};
    const pe = { ...(config.providers[preset.providerId] || {}) };
    pe.model = typeof preset.model === 'string' && preset.model.trim()
      ? preset.model.trim()
      : meta.defaultModel;
    config.providers[preset.providerId] = pe;
    await storage.writeLLMConfig(config);
    return { ok: true };
  });

  ipcMain.handle(REQ.SETTINGS_COMMIT_SETTINGS, async (_event, payload) => {
    const rawPresets = Array.isArray(payload?.presets) ? payload.presets : [];
    const presets = rawPresets
      .map((row) => storage.normalizePresetEntry(row))
      .filter(Boolean);
    if (presets.length === 0) {
      return { ok: false, error: 'Mindestens ein Modell-Eintrag ist erforderlich.' };
    }
    const seen = new Set();
    for (const p of presets) {
      if (seen.has(p.id)) {
        return { ok: false, error: 'Doppelte Eintrags-IDs in der Liste.' };
      }
      seen.add(p.id);
    }
    let activePresetId = typeof payload?.activePresetId === 'string' ? payload.activePresetId.trim() : null;
    if (!activePresetId || !presets.some((pr) => pr.id === activePresetId)) {
      activePresetId = presets[0].id;
    }

    const config = await storage.readLLMConfig();
    const patches =
      payload?.providerPatches && typeof payload.providerPatches === 'object'
        ? payload.providerPatches
        : {};

    for (const providerId of Object.keys(patches)) {
      const res = mergeProviderPatchIntoConfig(config, providerId, patches[providerId]);
      if (!res.ok) return res;
    }

    for (const pr of presets) {
      const meta = providers.getProvider(pr.providerId);
      const entry = (config.providers && config.providers[pr.providerId]) || {};
      const baseUrlEff = meta.fields?.baseUrl
        ? (entry.baseUrl || meta.defaultBaseUrl || '')
        : '';
      const configured = meta.fields?.apiKey
        ? !!entry.apiKeyEnc
        : meta.fields?.baseUrl
          ? !!String(baseUrlEff).trim()
          : true;
      if (!configured) {
        return {
          ok: false,
          error: `Zugang für „${meta.name}“ ist unvollständig (z. B. API-Schlüssel oder Server-URL).`,
        };
      }
    }

    const providerIdsInUse = new Set(presets.map((pr) => pr.providerId));
    config.providers = config.providers || {};
    for (const pid of Object.keys(config.providers)) {
      if (!providerIdsInUse.has(pid)) {
        delete config.providers[pid];
      }
    }

    config.version = 3;
    config.presets = presets;
    config.activePresetId = activePresetId;
    const target = storage.resolveChatModelTarget(config);
    config.activeProvider = target.providerId;
    const activeEntryPid = target.providerId;
    if (activeEntryPid && providers.getProvider(activeEntryPid)) {
      const pe = { ...(config.providers[activeEntryPid] || {}) };
      pe.model = target.model;
      config.providers[activeEntryPid] = pe;
    }

    await storage.writeLLMConfig(config);

    const uiPatch =
      payload?.uiPrefs && typeof payload.uiPrefs === 'object' ? payload.uiPrefs : {};
    if (
      typeof uiPatch.baseSystemPrompt === 'string'
      || uiPatch.appLocale === 'en'
      || uiPatch.appLocale === 'de'
      || typeof uiPatch.maxToolRounds === 'number'
    ) {
      const out = { ...(await storage.readUIPrefs()) };
      if (typeof uiPatch.baseSystemPrompt === 'string') {
        out.baseSystemPrompt = uiPatch.baseSystemPrompt;
      }
      if (uiPatch.appLocale === 'en' || uiPatch.appLocale === 'de') {
        out.appLocale = uiPatch.appLocale;
      }
      if (typeof uiPatch.maxToolRounds === 'number' && Number.isFinite(uiPatch.maxToolRounds)) {
        const clamped = Math.min(500, Math.max(1, Math.round(uiPatch.maxToolRounds)));
        out.maxToolRounds = clamped;
      }
      await storage.writeUIPrefs(out);
    }

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
    if (setActiveWorkspaceRoot) {
      setActiveWorkspaceRoot(folderPath);
    }
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
    if (typeof patch.baseSystemPrompt === 'string') {
      out.baseSystemPrompt = patch.baseSystemPrompt;
    }
    if (patch.appLocale === 'en' || patch.appLocale === 'de') {
      out.appLocale = patch.appLocale;
    }
    if (typeof patch.maxToolRounds === 'number' && Number.isFinite(patch.maxToolRounds)) {
      const clamped = Math.min(500, Math.max(1, Math.round(patch.maxToolRounds)));
      out.maxToolRounds = clamped;
    }
    await storage.writeUIPrefs(out);
    return out;
  });
}

module.exports = { registerSettingsHandlers };
