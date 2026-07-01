const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { registerChatHandlers, resolveToolRoundLimit } = require('../src/main/ipc/chat-handlers');
const { REQUEST_CHANNELS: REQ, PUSH_CHANNELS: PUSH } = require('../src/shared/ipc-channels');

test('resolveToolRoundLimit clamps to configured bounds', () => {
  assert.equal(resolveToolRoundLimit({}, 14), 14);
  assert.equal(resolveToolRoundLimit({ maxToolRounds: 0 }, 14), 1);
  assert.equal(resolveToolRoundLimit({ maxToolRounds: 9999 }, 14), 500);
  assert.equal(resolveToolRoundLimit({ maxToolRounds: 42.7 }, 14), 43);
});

function makeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, fn) { handlers.set(channel, fn); },
    on(channel, fn) { handlers.set(channel, fn); },
  };
}

function makeFakeEvent() {
  return { sender: { id: 1, isDestroyed: () => false, send: () => {} } };
}

function setupChatHandlers({ allowWorkspaceWrite }) {
  let capturedTools = null;
  const provider = {
    defaultModel: 'test-model',
    fields: {},
    async streamChatRound({ tools }) {
      capturedTools = tools;
      return { message: { role: 'assistant', content: 'ok' }, usage: null, finishReason: 'stop' };
    },
  };
  const storage = {
    readLLMConfig: async () => ({}),
    resolveChatModelTarget: () => ({ providerId: 'test', model: 'test-model' }),
    getEffectiveProviderConfig: async () => ({}),
    readUIPrefs: async () => ({ allowWorkspaceWrite }),
  };
  const ipcMain = makeIpcMain();
  registerChatHandlers({
    ipcMain,
    storage,
    providers: { getProvider: () => provider },
    fsService: { runWorkspaceTool: async () => JSON.stringify({ ok: true }) },
    path,
    defaultProviderId: 'test',
    maxToolRounds: 5,
    workspaceTools: [{ type: 'function', function: { name: 'list_directory' } }],
    writeWorkspaceTools: [{ type: 'function', function: { name: 'write_file_text' } }],
    REQ,
    PUSH,
  });
  return {
    handler: ipcMain.handlers.get(REQ.CHAT_SEND),
    getCapturedTools: () => capturedTools,
  };
}

test('CHAT_SEND omits write_file_text from tools when allowWorkspaceWrite is false', async () => {
  const { handler, getCapturedTools } = setupChatHandlers({ allowWorkspaceWrite: false });
  const result = await handler(makeFakeEvent(), {
    messages: [{ role: 'user', content: 'Hallo' }],
    workspaceRoot: '/tmp/weyouze-test-project',
  });

  const tools = getCapturedTools();
  assert.ok(Array.isArray(tools));
  assert.equal(tools.some((t) => t.function.name === 'write_file_text'), false);
  assert.equal(tools.some((t) => t.function.name === 'list_directory'), true);

  const sentSystemMessage = result.rawExchanges[0].messages[0];
  assert.equal(sentSystemMessage.role, 'system');
  assert.doesNotMatch(sentSystemMessage.content, /write_file_text/);
});

test('CHAT_SEND includes write_file_text in tools when allowWorkspaceWrite is true', async () => {
  const { handler, getCapturedTools } = setupChatHandlers({ allowWorkspaceWrite: true });
  const result = await handler(makeFakeEvent(), {
    messages: [{ role: 'user', content: 'Hallo' }],
    workspaceRoot: '/tmp/weyouze-test-project',
  });

  const tools = getCapturedTools();
  assert.ok(tools.some((t) => t.function.name === 'write_file_text'));

  const sentSystemMessage = result.rawExchanges[0].messages[0];
  assert.match(sentSystemMessage.content, /write_file_text/);
});
