const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createStorageService } = require('../src/main/services/storage-service');
const { registerChatHistoryHandlers } = require('../src/main/ipc/chat-history-handlers');
const { REQUEST_CHANNELS: REQ } = require('../src/shared/ipc-channels');
const { createMockIpcMain } = require('./helpers/mock-ipc');

const mockProviders = {
  getProvider(id) {
    return id === 'openai' ? { defaultModel: 'gpt-4o', fields: { apiKey: true } } : null;
  },
};

async function setup(t, { maxChatSessions = 3 } = {}) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'weyouze-chathist-'));
  t.after(() => fs.rm(tmpDir, { recursive: true, force: true }));
  const storage = createStorageService({
    app: { getPath: () => tmpDir },
    safeStorage: { isEncryptionAvailable: () => false },
    fs,
    path,
    providers: mockProviders,
    maxChatSessions,
    maxFolderHistory: 5,
    defaultProviderId: 'openai',
  });
  const ipcMain = createMockIpcMain();
  registerChatHistoryHandlers({ ipcMain, storage, REQ });
  return { ipcMain, storage, tmpDir };
}

function sessionRow(id, { workspaceRoot = null, updatedAt = 1000, title = `Chat ${id}` } = {}) {
  return {
    id,
    workspaceRoot,
    title,
    updatedAt,
    messages: [{ role: 'user', content: `hello from ${id}` }],
  };
}

test('upsert + get round-trips a session and respects workspace filtering', async (t) => {
  const { ipcMain, tmpDir } = await setup(t);
  const ws = tmpDir;

  await ipcMain.invoke(REQ.CHAT_HISTORY_UPSERT, sessionRow('a', { workspaceRoot: ws }));
  await ipcMain.invoke(REQ.CHAT_HISTORY_UPSERT, sessionRow('b'));
  await ipcMain.invoke(REQ.CHAT_HISTORY_SET_ACTIVE, ws, 'a');

  const inWs = await ipcMain.invoke(REQ.CHAT_HISTORY_GET, ws);
  assert.deepEqual(inWs.sessions.map((s) => s.id), ['a']);
  assert.equal(inWs.activeChatId, 'a');

  const noWs = await ipcMain.invoke(REQ.CHAT_HISTORY_GET, null);
  assert.deepEqual(noWs.sessions.map((s) => s.id), ['b']);
  assert.equal(noWs.activeChatId, null);
});

test('upsert rejects invalid session rows', async (t) => {
  const { ipcMain } = await setup(t);
  assert.deepEqual(await ipcMain.invoke(REQ.CHAT_HISTORY_UPSERT, null), { ok: false });
  assert.deepEqual(await ipcMain.invoke(REQ.CHAT_HISTORY_UPSERT, { id: '   ' }), { ok: false });
});

test('delete removes the session and its active pointer', async (t) => {
  const { ipcMain, tmpDir } = await setup(t);
  const ws = tmpDir;
  await ipcMain.invoke(REQ.CHAT_HISTORY_UPSERT, sessionRow('a', { workspaceRoot: ws }));
  await ipcMain.invoke(REQ.CHAT_HISTORY_SET_ACTIVE, ws, 'a');

  const res = await ipcMain.invoke(REQ.CHAT_HISTORY_DELETE, 'a');
  assert.equal(res.ok, true);

  const after = await ipcMain.invoke(REQ.CHAT_HISTORY_GET, ws);
  assert.deepEqual(after.sessions, []);
  assert.equal(after.activeChatId, null);

  assert.deepEqual(await ipcMain.invoke(REQ.CHAT_HISTORY_DELETE, ''), { ok: false });
});

test('setActive clears the pointer for empty ids', async (t) => {
  const { ipcMain, tmpDir } = await setup(t);
  const ws = tmpDir;
  await ipcMain.invoke(REQ.CHAT_HISTORY_UPSERT, sessionRow('a', { workspaceRoot: ws }));
  await ipcMain.invoke(REQ.CHAT_HISTORY_SET_ACTIVE, ws, 'a');
  await ipcMain.invoke(REQ.CHAT_HISTORY_SET_ACTIVE, ws, null);
  const after = await ipcMain.invoke(REQ.CHAT_HISTORY_GET, ws);
  assert.equal(after.activeChatId, null);
});

test('pruning beyond MAX_CHAT_SESSIONS drops oldest sessions and their active pointers', async (t) => {
  const { ipcMain, tmpDir } = await setup(t, { maxChatSessions: 3 });
  const ws = tmpDir;
  for (let i = 1; i <= 4; i++) {
    await ipcMain.invoke(
      REQ.CHAT_HISTORY_UPSERT,
      sessionRow(`s${i}`, { workspaceRoot: ws, updatedAt: i * 1000 })
    );
    if (i === 1) await ipcMain.invoke(REQ.CHAT_HISTORY_SET_ACTIVE, ws, 's1');
  }
  const after = await ipcMain.invoke(REQ.CHAT_HISTORY_GET, ws);
  assert.deepEqual(after.sessions.map((s) => s.id), ['s4', 's3', 's2']);
  assert.equal(after.activeChatId, null, 'active pointer to pruned s1 must be cleared');
});

test('parallel upserts of distinct sessions lose no updates', async (t) => {
  const { ipcMain, tmpDir } = await setup(t, { maxChatSessions: 100 });
  const ws = tmpDir;
  const ids = Array.from({ length: 20 }, (_, i) => `c${i}`);
  await Promise.all(
    ids.map((id, i) =>
      ipcMain.invoke(REQ.CHAT_HISTORY_UPSERT, sessionRow(id, { workspaceRoot: ws, updatedAt: i }))
    )
  );
  const after = await ipcMain.invoke(REQ.CHAT_HISTORY_GET, ws);
  assert.deepEqual(new Set(after.sessions.map((s) => s.id)), new Set(ids));
});

test('parallel upsert/delete/setActive interleaving stays consistent', async (t) => {
  const { ipcMain, tmpDir } = await setup(t, { maxChatSessions: 100 });
  const ws = tmpDir;
  await ipcMain.invoke(REQ.CHAT_HISTORY_UPSERT, sessionRow('keep', { workspaceRoot: ws }));

  await Promise.all([
    ipcMain.invoke(REQ.CHAT_HISTORY_UPSERT, sessionRow('temp', { workspaceRoot: ws })),
    ipcMain.invoke(REQ.CHAT_HISTORY_DELETE, 'temp'),
    ipcMain.invoke(REQ.CHAT_HISTORY_SET_ACTIVE, ws, 'keep'),
    ipcMain.invoke(REQ.CHAT_HISTORY_UPSERT, sessionRow('keep', { workspaceRoot: ws, title: 'Updated' })),
  ]);

  const after = await ipcMain.invoke(REQ.CHAT_HISTORY_GET, ws);
  const keep = after.sessions.find((s) => s.id === 'keep');
  assert.ok(keep, 'session "keep" must survive the interleaving');
  assert.equal(keep.title, 'Updated');
  assert.equal(after.activeChatId, 'keep');
});

test('repeated upserts of the same id serialize through the lock (last write wins)', async (t) => {
  const { ipcMain, tmpDir } = await setup(t, { maxChatSessions: 100 });
  const ws = tmpDir;
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      ipcMain.invoke(
        REQ.CHAT_HISTORY_UPSERT,
        sessionRow('same', { workspaceRoot: ws, updatedAt: 1000 + i, title: `v${i}` })
      )
    )
  );
  const after = await ipcMain.invoke(REQ.CHAT_HISTORY_GET, ws);
  assert.equal(after.sessions.length, 1, 'concurrent upserts of one id must not duplicate it');
  assert.equal(after.sessions[0].title, 'v9');
});
