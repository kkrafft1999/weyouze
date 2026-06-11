const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  registerSettingsHandlers,
  mergeProviderPatchIntoConfigImpl,
} = require('../src/main/ipc/settings-handlers');
const { createStorageService } = require('../src/main/services/storage-service');
const { REQUEST_CHANNELS: REQ } = require('../src/shared/ipc-channels');
const { createMockIpcMain } = require('./helpers/mock-ipc');

const mockProviders = {
  getProvider(id) {
    if (id === 'openai') {
      return { defaultModel: 'gpt-4o', fields: { apiKey: true } };
    }
    if (id === 'ollama') {
      return { defaultModel: 'llama3', fields: { baseUrl: true } };
    }
    return null;
  },
};

function makeDeps(encryptionAvailable = true) {
  return {
    safeStorage: {
      isEncryptionAvailable: () => encryptionAvailable,
      encryptString(plaintext) {
        return Buffer.from(`enc:${plaintext}`, 'utf8');
      },
    },
    providers: mockProviders,
  };
}

test('mergeProviderPatchIntoConfigImpl removes apiKeyEnc when removeApiKey is true', () => {
  const config = {
    providers: {
      openai: {
        apiKeyEnc: 'stored-key',
        model: 'gpt-4o',
      },
    },
  };

  const res = mergeProviderPatchIntoConfigImpl(makeDeps(), config, 'openai', {
    removeApiKey: true,
  });

  assert.equal(res.ok, true);
  assert.equal(config.providers.openai.apiKeyEnc, undefined);
  assert.equal(config.providers.openai.model, 'gpt-4o');
});

test('mergeProviderPatchIntoConfigImpl replaces key after removal when new apiKey is set', () => {
  const config = {
    providers: {
      openai: {
        apiKeyEnc: 'stored-key',
      },
    },
  };

  const res = mergeProviderPatchIntoConfigImpl(makeDeps(), config, 'openai', {
    removeApiKey: true,
    apiKey: 'new-secret',
  });

  assert.equal(res.ok, true);
  assert.equal(config.providers.openai.apiKeyEnc, Buffer.from('enc:new-secret', 'utf8').toString('base64'));
});

test('mergeProviderPatchIntoConfigImpl does not require encryption for removal only', () => {
  const config = {
    providers: {
      openai: {
        apiKeyEnc: 'stored-key',
      },
    },
  };

  const res = mergeProviderPatchIntoConfigImpl(makeDeps(false), config, 'openai', {
    removeApiKey: true,
  });

  assert.equal(res.ok, true);
  assert.equal(config.providers.openai.apiKeyEnc, undefined);
});

// --- registerSettingsHandlers: commitSettings flow + listModels error paths ---

function makeHandlerProviders({ listModelsImpl } = {}) {
  const metaById = {
    openai: {
      id: 'openai',
      name: 'OpenAI',
      fields: { apiKey: true },
      defaultModel: 'gpt-4o',
      listModels: listModelsImpl || (async () => ({ models: [] })),
    },
    ollama: {
      id: 'ollama',
      name: 'Ollama',
      fields: { baseUrl: true },
      defaultModel: 'llama3',
      defaultBaseUrl: 'http://127.0.0.1:11434',
      listModels: listModelsImpl || (async () => ({ models: [] })),
    },
  };
  return {
    getProvider: (id) => metaById[id] || null,
    listProviderMeta: () => Object.values(metaById),
  };
}

async function setupHandlers(t, { encryptionAvailable = true, listModelsImpl } = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-settings-'));
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }));
  const safeStorage = {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (plaintext) => Buffer.from(`enc:${plaintext}`, 'utf8'),
    decryptString: (buf) => {
      const s = buf.toString('utf8');
      if (!s.startsWith('enc:')) throw new Error('bad cipher');
      return s.slice(4);
    },
  };
  const providers = makeHandlerProviders({ listModelsImpl });
  const storage = createStorageService({
    app: { getPath: () => tmpDir },
    safeStorage,
    fs,
    path,
    providers,
    maxChatSessions: 10,
    maxFolderHistory: 5,
    defaultProviderId: 'openai',
  });
  const ipcMain = createMockIpcMain();
  registerSettingsHandlers({
    ipcMain,
    safeStorage,
    storage,
    providers,
    defaultProviderId: 'openai',
    REQ,
    setActiveWorkspaceRoot: () => {},
  });
  return { ipcMain, storage };
}

test('commitSettings rejects an empty preset list', async (t) => {
  const { ipcMain } = await setupHandlers(t);
  const res = await ipcMain.invoke(REQ.SETTINGS_COMMIT_SETTINGS, { presets: [] });
  assert.equal(res.ok, false);
  assert.match(res.error, /Mindestens ein Modell-Eintrag/);
});

test('commitSettings rejects duplicate preset ids', async (t) => {
  const { ipcMain } = await setupHandlers(t);
  const res = await ipcMain.invoke(REQ.SETTINGS_COMMIT_SETTINGS, {
    presets: [
      { id: 'p1', providerId: 'ollama', model: 'llama3' },
      { id: 'p1', providerId: 'ollama', model: 'mistral' },
    ],
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /Doppelte Eintrags-IDs/);
});

test('commitSettings fails early when a key arrives without encrypted storage', async (t) => {
  const { ipcMain } = await setupHandlers(t, { encryptionAvailable: false });
  const res = await ipcMain.invoke(REQ.SETTINGS_COMMIT_SETTINGS, {
    presets: [{ id: 'p1', providerId: 'openai', model: 'gpt-4o' }],
    providerPatches: { openai: { apiKey: 'sk-test' } },
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /Verschlüsselter Speicher/);
});

test('commitSettings rejects presets whose provider is not configured', async (t) => {
  const { ipcMain, storage } = await setupHandlers(t);
  const res = await ipcMain.invoke(REQ.SETTINGS_COMMIT_SETTINGS, {
    presets: [{ id: 'p1', providerId: 'openai', model: 'gpt-4o' }],
  });
  assert.equal(res.ok, false);
  assert.match(res.error, /unvollständig/);
  const config = await storage.readLLMConfig();
  assert.equal(
    config.presets.some((p) => p.id === 'p1'),
    false,
    'failed commit must not persist presets'
  );
});

test('commitSettings persists presets, encrypts keys, prunes unused providers and writes UI prefs', async (t) => {
  const { ipcMain, storage } = await setupHandlers(t);
  await storage.updateLLMConfig(async (config) => {
    config.providers = { ollama: { baseUrl: 'http://old:1' } };
    return config;
  });

  const res = await ipcMain.invoke(REQ.SETTINGS_COMMIT_SETTINGS, {
    presets: [
      { id: 'p1', providerId: 'openai', model: 'gpt-4o-mini' },
      { id: 'p2', providerId: 'openai', model: 'gpt-4o' },
    ],
    activePresetId: 'p2',
    providerPatches: { openai: { apiKey: ' sk-secret ' } },
    uiPrefs: { maxToolRounds: 9999, appLocale: 'en' },
  });
  assert.deepEqual(res, { ok: true });

  const config = await storage.readLLMConfig();
  assert.equal(config.version, 3);
  assert.deepEqual(config.presets.map((p) => p.id), ['p1', 'p2']);
  assert.equal(config.activePresetId, 'p2');
  assert.equal(config.activeProvider, 'openai');
  assert.equal(config.providers.openai.model, 'gpt-4o');
  assert.equal(
    config.providers.openai.apiKeyEnc,
    Buffer.from('enc:sk-secret', 'utf8').toString('base64'),
    'key must be trimmed and encrypted'
  );
  assert.equal(config.providers.ollama, undefined, 'unused provider entries must be pruned');

  const prefs = await storage.readUIPrefs();
  assert.equal(prefs.maxToolRounds, 500, 'maxToolRounds must be clamped');
  assert.equal(prefs.appLocale, 'en');
});

test('commitSettings falls back to the first preset when activePresetId is unknown', async (t) => {
  const { ipcMain, storage } = await setupHandlers(t);
  const res = await ipcMain.invoke(REQ.SETTINGS_COMMIT_SETTINGS, {
    presets: [{ id: 'p1', providerId: 'ollama', model: 'llama3' }],
    activePresetId: 'does-not-exist',
  });
  assert.deepEqual(res, { ok: true });
  const config = await storage.readLLMConfig();
  assert.equal(config.activePresetId, 'p1');
  assert.equal(config.activeProvider, 'ollama');
});

test('listModels returns an error for unknown providers', async (t) => {
  const { ipcMain } = await setupHandlers(t);
  const res = await ipcMain.invoke(REQ.SETTINGS_LIST_MODELS, { providerId: 'nope' });
  assert.deepEqual(res, { error: 'Unbekannter Provider.' });
});

test('listModels surfaces provider exceptions as error results', async (t) => {
  const { ipcMain } = await setupHandlers(t, {
    listModelsImpl: async () => {
      throw new Error('Server nicht erreichbar');
    },
  });
  const res = await ipcMain.invoke(REQ.SETTINGS_LIST_MODELS, { providerId: 'ollama' });
  assert.deepEqual(res, { error: 'Server nicht erreichbar' });
});

test('listModels prefers incoming credentials over stored config', async (t) => {
  let seenConfig = null;
  const { ipcMain, storage } = await setupHandlers(t, {
    listModelsImpl: async (config) => {
      seenConfig = config;
      return { models: [{ id: 'm1', label: 'm1' }] };
    },
  });
  await storage.updateLLMConfig(async (config) => {
    config.providers = {
      openai: { apiKeyEnc: Buffer.from('enc:stored-key', 'utf8').toString('base64') },
    };
    return config;
  });

  const res = await ipcMain.invoke(REQ.SETTINGS_LIST_MODELS, {
    providerId: 'openai',
    apiKey: ' incoming-key ',
  });
  assert.deepEqual(res, { models: [{ id: 'm1', label: 'm1' }] });
  assert.equal(seenConfig.apiKey, 'incoming-key');

  await ipcMain.invoke(REQ.SETTINGS_LIST_MODELS, { providerId: 'openai' });
  assert.equal(seenConfig.apiKey, 'stored-key', 'stored key must be decrypted as fallback');
});

test('setUIPrefs persists a clamped historyCharLimit', async (t) => {
  const { ipcMain, storage } = await setupHandlers(t);
  await ipcMain.invoke(REQ.SETTINGS_SET_UI_PREFS, { historyCharLimit: 100 });
  let prefs = await storage.readUIPrefs();
  assert.equal(prefs.historyCharLimit, 4000, 'limit must be clamped to the minimum');

  await ipcMain.invoke(REQ.SETTINGS_SET_UI_PREFS, { historyCharLimit: 50_000 });
  prefs = await storage.readUIPrefs();
  assert.equal(prefs.historyCharLimit, 50_000);

  await ipcMain.invoke(REQ.SETTINGS_SET_UI_PREFS, { historyCharLimit: 'nope' });
  prefs = await storage.readUIPrefs();
  assert.equal(prefs.historyCharLimit, 50_000, 'invalid values must not overwrite the stored limit');
});
