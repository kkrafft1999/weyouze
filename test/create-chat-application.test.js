const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createChatApplication } = require('../src/main/composition/create-chat-application');

function assistantToolCall(id, name, args) {
  return {
    message: {
      role: 'assistant',
      content: null,
      tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
    },
    finishReason: 'tool_calls',
    usage: null,
  };
}

function assistantText(content) {
  return { message: { role: 'assistant', content }, finishReason: 'stop', usage: null };
}

test('createChatApplication wires raw recorder through provider rounds end-to-end', async () => {
  let round = 0;
  const provider = {
    id: 'test',
    name: 'Test',
    defaultModel: 'test-model',
    fields: {},
    async streamChatRound({ recorder, callbacks }) {
      recorder?.request({
        url: 'https://example.test/v1/chat',
        method: 'POST',
        headers: { Authorization: 'Bearer sk-test' },
        body: { model: 'test-model', stream: true },
      });
      recorder?.onRawLine('data: {"delta":"hi"}');
      callbacks?.onTextDelta('hi');
      round += 1;
      if (round === 1) {
        return assistantToolCall('call_1', 'list_directory', { relative_path: '.' });
      }
      return assistantText('done');
    },
  };

  const storage = {
    readLLMConfig: async () => ({}),
    resolveChatModelTarget: () => ({ providerId: 'test', model: 'test-model' }),
    getEffectiveProviderConfig: async () => ({ apiKey: 'sk-test', model: 'test-model' }),
    readUIPrefs: async () => ({}),
  };

  const toolRegistry = {
    getTools: () => [{ type: 'function', function: { name: 'list_directory' } }],
    buildSystemPrompt: () => 'Tools: list_directory',
    execute: async () => JSON.stringify({ ok: true }),
  };

  const { engine } = createChatApplication({
    storage,
    providers: { getProvider: () => provider },
    toolRegistry,
    path,
    maxToolRounds: 3,
  });

  const result = await engine.send({
    sessionId: 'e2e-1',
    payload: {
      messages: [{ role: 'user', content: 'Liste' }],
      workspaceRoot: '/tmp/weyouze-project',
    },
  });

  assert.equal(result.content, 'done');
  assert.equal(result.rawExchanges.length, 2);
  assert.equal(result.rawExchanges[0].request.method, 'POST');
  assert.match(result.rawExchanges[0].request.url, /example\.test/);
  assert.match(result.rawExchanges[0].responseRaw, /data:/);
  assert.equal(result.rawExchanges[0].request.headers.Authorization, '***redigiert***');
});
