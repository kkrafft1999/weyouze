const {
  createSettingsOk,
  createSettingsError,
  createListModelsResult,
  normalizeListModelsRequest,
  normalizeUiPrefsPatch,
} = require('../../shared/contracts/settings');
const { createSettingsPresentationService } = require('../services/settings-presentation-service');

function registerSettingsHandlers({
  ipcMain,
  safeStorage,
  storage,
  providers,
  defaultProviderId,
  REQ,
  setActiveWorkspaceRoot,
  presentation,
}) {
  const presentationService = presentation || createSettingsPresentationService({
    providers,
    defaultProviderId,
  });

  ipcMain.handle(REQ.SETTINGS_GET_LLM_STATE, async () => {
    const encryptionAvailable = safeStorage.isEncryptionAvailable();
    const config = await storage.readLLMConfig();
    const chatTarget = storage.resolveChatModelTarget(config);
    const presetsWire = Array.isArray(config.presets)
      ? config.presets.map((row) => storage.normalizePresetEntry(row)).filter(Boolean)
      : [];
    return presentationService.buildLlmStateDto({
      encryptionAvailable,
      config: { ...config, presets: presetsWire },
      chatTarget,
    });
  });

  function mergeProviderPatchIntoConfig(config, providerId, patch) {
    return mergeProviderPatchIntoConfigImpl({ safeStorage, providers }, config, providerId, patch);
  }

  ipcMain.handle(REQ.SETTINGS_SET_ACTIVE_PRESET, async (_event, presetId) => {
    if (typeof presetId !== 'string' || !presetId.trim()) {
      return createSettingsError('Kein Eintrag gewählt.');
    }
    let validationError = null;
    await storage.updateLLMConfig(async (config) => {
      const preset = Array.isArray(config.presets)
        ? config.presets.find((p) => p && p.id === presetId.trim())
        : null;
      if (!preset || !providers.getProvider(preset.providerId)) {
        validationError = createSettingsError('Eintrag nicht gefunden.');
        return config;
      }
      const meta = providers.getProvider(preset.providerId);
      const entry = (config.providers && config.providers[preset.providerId]) || {};
      const configured = meta.fields?.apiKey
        ? !!entry.apiKeyEnc
        : meta.fields?.baseUrl
          ? !!(entry.baseUrl || meta.defaultBaseUrl)
          : true;
      if (!configured) {
        validationError = createSettingsError('Anbieter ist noch nicht konfiguriert.');
        return config;
      }
      config.activePresetId = presetId.trim();
      config.activeProvider = preset.providerId;
      config.providers = config.providers || {};
      const pe = { ...(config.providers[preset.providerId] || {}) };
      pe.model = typeof preset.model === 'string' && preset.model.trim()
        ? preset.model.trim()
        : meta.defaultModel;
      config.providers[preset.providerId] = pe;
      return config;
    });
    if (validationError) return validationError;
    return createSettingsOk();
  });

  ipcMain.handle(REQ.SETTINGS_COMMIT_SETTINGS, async (_event, payload) => {
    const rawPresets = Array.isArray(payload?.presets) ? payload.presets : [];
    const presets = rawPresets
      .map((row) => storage.normalizePresetEntry(row))
      .filter(Boolean);
    if (presets.length === 0) {
      return createSettingsError('Mindestens ein Modell-Eintrag ist erforderlich.');
    }
    const seen = new Set();
    for (const p of presets) {
      if (seen.has(p.id)) {
        return createSettingsError('Doppelte Eintrags-IDs in der Liste.');
      }
      seen.add(p.id);
    }
    let activePresetId = typeof payload?.activePresetId === 'string' ? payload.activePresetId.trim() : null;
    if (!activePresetId || !presets.some((pr) => pr.id === activePresetId)) {
      activePresetId = presets[0].id;
    }

    const patches =
      payload?.providerPatches && typeof payload.providerPatches === 'object'
        ? payload.providerPatches
        : {};

    for (const pr of presets) {
      const meta = providers.getProvider(pr.providerId);
      if (!meta) continue;
      const patch = patches[pr.providerId];
      const incomingKey = typeof patch?.apiKey === 'string' ? patch.apiKey.trim() : '';
      if (meta.fields?.apiKey && incomingKey) {
        if (!safeStorage.isEncryptionAvailable()) {
          return createSettingsError('Verschlüsselter Speicher ist nicht verfügbar.');
        }
      }
    }

    let validationError = null;
    await storage.updateLLMConfig(async (config) => {
      const draft = cloneLlmConfig(config);

      for (const providerId of Object.keys(patches)) {
        const res = mergeProviderPatchIntoConfig(draft, providerId, patches[providerId]);
        if (!res.ok) {
          validationError = res;
          return config;
        }
      }

      for (const pr of presets) {
        const meta = providers.getProvider(pr.providerId);
        const entry = (draft.providers && draft.providers[pr.providerId]) || {};
        if (!isProviderConfigured(meta, entry)) {
          validationError = createSettingsError(
            `Zugang für „${meta.name}“ ist unvollständig (z. B. API-Schlüssel oder Server-URL).`
          );
          return config;
        }
      }

      const providerIdsInUse = new Set(presets.map((pr) => pr.providerId));
      draft.providers = draft.providers || {};
      for (const pid of Object.keys(draft.providers)) {
        if (!providerIdsInUse.has(pid)) {
          delete draft.providers[pid];
        }
      }

      draft.version = 3;
      draft.presets = presets;
      draft.activePresetId = activePresetId;
      const target = storage.resolveChatModelTarget(draft);
      draft.activeProvider = target.providerId;
      const activeEntryPid = target.providerId;
      if (activeEntryPid && providers.getProvider(activeEntryPid)) {
        const pe = { ...(draft.providers[activeEntryPid] || {}) };
        pe.model = target.model;
        draft.providers[activeEntryPid] = pe;
      }

      return draft;
    });
    if (validationError) return validationError;

    const uiPatch = normalizeUiPrefsPatch(payload?.uiPrefs);
    if (Object.keys(uiPatch).length > 0) {
      await storage.updateUIPrefs(async (out) => Object.assign(out, uiPatch));
    }

    return createSettingsOk();
  });

  ipcMain.handle(REQ.SETTINGS_LIST_MODELS, async (_event, payload) => {
    const req = normalizeListModelsRequest(payload);
    const provider = providers.getProvider(req.providerId);
    if (!provider) return createListModelsResult({ error: 'Unbekannter Provider.' });

    const stored = (await storage.getEffectiveProviderConfig(req.providerId)) || {};
    const config = {
      apiKey: req.apiKey || stored.apiKey || '',
      baseUrl: req.baseUrl || stored.baseUrl || provider.defaultBaseUrl || '',
      insecureTls: typeof req.insecureTls === 'boolean'
        ? req.insecureTls
        : (typeof stored.insecureTls === 'boolean'
            ? stored.insecureTls
            : provider.defaultInsecureTls === true),
    };
    try {
      const result = await provider.listModels(config);
      if (result?.error) return createListModelsResult({ error: result.error });
      return createListModelsResult({ models: result?.models });
    } catch (err) {
      return createListModelsResult({ error: err.message || 'Modelle konnten nicht geladen werden.' });
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
    return createSettingsOk();
  });

  ipcMain.handle(REQ.SETTINGS_GET_FOLDER_HISTORY, async () => {
    const paths = await storage.getValidatedFolderHistory();
    return { paths };
  });

  ipcMain.handle(REQ.SETTINGS_GET_UI_PREFS, async () => storage.readUIPrefs());

  ipcMain.handle(REQ.SETTINGS_SET_UI_PREFS, async (_event, partial) => {
    const patch = normalizeUiPrefsPatch(partial);
    if (Object.keys(patch).length === 0) {
      return storage.readUIPrefs();
    }
    return storage.updateUIPrefs(async (out) => Object.assign(out, patch));
  });
}

function mergeProviderPatchIntoConfigImpl(deps, config, providerId, patch) {
  const { safeStorage, providers } = deps;
  const provider = providers.getProvider(providerId);
  if (!provider) return createSettingsError('Unbekannter Provider.');
  const prevEntry = (config.providers && config.providers[providerId]) || {};
  const next = { ...prevEntry };

  if (provider.fields?.apiKey) {
    if (patch?.removeApiKey === true) {
      delete next.apiKeyEnc;
    }
    const incomingKey = typeof patch?.apiKey === 'string' ? patch.apiKey.trim() : '';
    if (incomingKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        return createSettingsError('Verschlüsselter Speicher ist nicht verfügbar.');
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
  return createSettingsOk();
}

function cloneLlmConfig(config) {
  return JSON.parse(JSON.stringify(config));
}

function isProviderConfigured(meta, entry) {
  const baseUrlEff = meta.fields?.baseUrl
    ? (entry.baseUrl || meta.defaultBaseUrl || '')
    : '';
  return meta.fields?.apiKey
    ? !!entry.apiKeyEnc
    : meta.fields?.baseUrl
      ? !!String(baseUrlEff).trim()
      : true;
}

module.exports = { registerSettingsHandlers, mergeProviderPatchIntoConfigImpl };
