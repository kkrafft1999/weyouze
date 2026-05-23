const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createStorageService } = require('../src/main/services/storage-service');

const mockProviders = {
  getProvider(id) {
    if (id === 'openai') {
      return { defaultModel: 'gpt-4o', fields: { apiKey: true } };
    }
    if (id === 'anthropic') {
      return { defaultModel: 'claude-test', fields: { apiKey: true } };
    }
    return null;
  },
};

function makeStorage(tmpDir) {
  return createStorageService({
    app: { getPath: () => tmpDir },
    safeStorage: { isEncryptionAvailable: () => false },
    fs,
    path,
    providers: mockProviders,
    maxChatSessions: 3,
    maxFolderHistory: 5,
    defaultProviderId: 'openai',
  });
}

function makeEncryptedSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString(plaintext) {
      return Buffer.from(`enc:${plaintext}`, 'utf8');
    },
    decryptString(buf) {
      const s = buf.toString('utf8');
      if (!s.startsWith('enc:')) throw new Error('bad cipher');
      return s.slice(4);
    },
  };
}

function makeStorageWithEncryption(tmpDir) {
  return createStorageService({
    app: { getPath: () => tmpDir },
    safeStorage: makeEncryptedSafeStorage(),
    fs,
    path,
    providers: mockProviders,
    maxChatSessions: 3,
    maxFolderHistory: 5,
    defaultProviderId: 'openai',
  });
}

test('normalizePresetEntry validates provider and model', () => {
  const storage = makeStorage('/tmp/unused');
  assert.equal(storage.normalizePresetEntry(null), null);
  assert.equal(storage.normalizePresetEntry({ id: '', providerId: 'openai' }), null);
  assert.equal(storage.normalizePresetEntry({ id: 'p1', providerId: 'unknown' }), null);

  const preset = storage.normalizePresetEntry({
    id: 'p1',
    providerId: 'openai',
    model: 'gpt-4o-mini',
    reasoningEffort: 'high',
  });
  assert.deepEqual(preset, {
    id: 'p1',
    providerId: 'openai',
    model: 'gpt-4o-mini',
    reasoningEffort: 'high',
    menuVisible: true,
  });
});

test('resolveChatModelTarget prefers active preset', () => {
  const storage = makeStorage('/tmp/unused');
  const target = storage.resolveChatModelTarget({
    activePresetId: 'p1',
    activeProvider: 'openai',
    presets: [
      { id: 'p1', providerId: 'anthropic', model: 'claude-custom', reasoningEffort: null, menuVisible: true },
    ],
    providers: {},
  });
  assert.deepEqual(target, {
    providerId: 'anthropic',
    model: 'claude-custom',
    reasoningEffort: null,
  });
});

test('normalizeSessionForStore strips invalid roles and caps title', () => {
  const storage = makeStorage('/tmp/unused');
  const session = storage.normalizeSessionForStore({
    id: 's1',
    title: 'x'.repeat(300),
    updatedAt: 42,
    workspaceRoot: '/tmp/ws',
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello', reasoningText: 'think' },
      { role: 'system', content: 'ignored' },
    ],
  });
  assert.equal(session.title.length, 200);
  assert.equal(session.messages.length, 2);
  assert.equal(session.messages[1].reasoningText, 'think');
});

test('writeJsonAtomic keeps previous file on interrupted write simulation', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-storage-'));
  const storage = makeStorage(tmpDir);
  await storage.writeUIPrefs({ contentPaneVisible: true, appLocale: 'de' });

  const target = path.join(tmpDir, 'ui-preferences.json');
  const original = await fs.readFile(target, 'utf8');

  const realWriteFile = fs.writeFile.bind(fs);
  let failNext = true;
  fs.writeFile = async (filePath, data, encoding) => {
    await realWriteFile(filePath, data, encoding);
    if (failNext && String(filePath).includes('.tmp-')) {
      failNext = false;
      throw new Error('simulated crash');
    }
  };

  await assert.rejects(() => storage.writeUIPrefs({ contentPaneVisible: false, appLocale: 'en' }));
  fs.writeFile = realWriteFile;

  const after = await fs.readFile(target, 'utf8');
  assert.equal(after, original);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('withChatHistoryLock serializes concurrent upserts', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-storage-'));
  const storage = makeStorage(tmpDir);

  await Promise.all([
    storage.withChatHistoryLock(async () => {
      const store = await storage.readChatHistoryStore();
      store.sessions.push({
        id: 'a',
        workspaceRoot: null,
        title: 'A',
        updatedAt: 1,
        messages: [],
      });
      await storage.writeChatHistoryStore(store);
    }),
    storage.withChatHistoryLock(async () => {
      const store = await storage.readChatHistoryStore();
      store.sessions.push({
        id: 'b',
        workspaceRoot: null,
        title: 'B',
        updatedAt: 2,
        messages: [],
      });
      await storage.writeChatHistoryStore(store);
    }),
  ]);

  const final = await storage.readChatHistoryStore();
  assert.equal(final.sessions.length, 2);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('writeChatHistoryStore encrypts when safeStorage available', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-storage-'));
  const storage = makeStorageWithEncryption(tmpDir);
  const store = {
    version: 2,
    activeByWorkspace: {},
    sessions: [{
      id: 's1',
      workspaceRoot: null,
      title: 'Test',
      updatedAt: 1,
      messages: [{ role: 'user', content: 'hello' }],
    }],
  };

  await storage.writeChatHistoryStore(store);

  const raw = await fs.readFile(path.join(tmpDir, 'chat-history.json'), 'utf8');
  const onDisk = JSON.parse(raw);
  assert.equal(onDisk.encrypted, true);
  assert.equal(typeof onDisk.payload, 'string');
  assert.equal(onDisk.version, undefined);

  const roundtrip = await storage.readChatHistoryStore();
  assert.equal(roundtrip.sessions.length, 1);
  assert.equal(roundtrip.sessions[0].id, 's1');
  assert.equal(roundtrip.sessions[0].messages[0].content, 'hello');

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('readChatHistoryStore migrates plaintext to encrypted on read', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-storage-'));
  const plaintext = {
    version: 2,
    activeByWorkspace: {},
    sessions: [{
      id: 'legacy',
      workspaceRoot: null,
      title: 'Legacy',
      updatedAt: 2,
      messages: [],
    }],
  };
  await fs.writeFile(
    path.join(tmpDir, 'chat-history.json'),
    JSON.stringify(plaintext),
    'utf8',
  );

  const storage = makeStorageWithEncryption(tmpDir);
  const store = await storage.readChatHistoryStore();
  assert.equal(store.sessions[0].id, 'legacy');

  const raw = await fs.readFile(path.join(tmpDir, 'chat-history.json'), 'utf8');
  const onDisk = JSON.parse(raw);
  assert.equal(onDisk.encrypted, true);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('readChatHistoryStore falls back to plaintext when encryption unavailable', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-storage-'));
  const storage = makeStorage(tmpDir);
  const store = {
    version: 2,
    activeByWorkspace: { __none__: 's1' },
    sessions: [{
      id: 's1',
      workspaceRoot: null,
      title: 'Plain',
      updatedAt: 3,
      messages: [],
    }],
  };

  await storage.writeChatHistoryStore(store);

  const raw = await fs.readFile(path.join(tmpDir, 'chat-history.json'), 'utf8');
  const onDisk = JSON.parse(raw);
  assert.equal(onDisk.encrypted, undefined);
  assert.equal(onDisk.sessions[0].id, 's1');

  const roundtrip = await storage.readChatHistoryStore();
  assert.equal(roundtrip.activeByWorkspace.__none__, 's1');

  await fs.rm(tmpDir, { recursive: true, force: true });
});
