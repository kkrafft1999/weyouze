const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createChatEngine, CHAT_ENGINE_EVENTS } = require('../src/main/chat-engine');

function makeStorage(overrides = {}) {
  return {
    readLLMConfig: async () => ({}),
    resolveChatModelTarget: () => ({ providerId: 'test' }),
    getEffectiveProviderConfig: async () => ({ apiKey: 'sk-test' }),
    readUIPrefs: async () => ({}),
    ...overrides,
  };
}

function makeToolRegistry(execute) {
  const calls = [];
  return {
    calls,
    getTools: () => [{ type: 'function', function: { name: 'list_directory' } }],
    buildSystemPrompt: () => 'Tools: list_directory',
    async execute(toolName, args, context) {
      calls.push({ toolName, args, context });
      return execute ? execute(toolName, args, context) : JSON.stringify({ ok: true });
    },
  };
}

function assistantText(content, extra = {}) {
  return { message: { role: 'assistant', content }, finishReason: 'stop', usage: null, ...extra };
}

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

function makeEngine(results, { storage, toolRegistry, provider } = {}) {
  let resultIndex = 0;
  const calls = [];
  const scriptedProvider = provider || {
    defaultModel: 'test-model',
    fields: {},
    async streamChatRound(args) {
      calls.push(args);
      const result = typeof results === 'function'
        ? results(args, resultIndex)
        : results[Math.min(resultIndex, results.length - 1)];
      resultIndex += 1;
      return result;
    },
  };
  return {
    calls,
    toolRegistry: toolRegistry || makeToolRegistry(),
    engine: createChatEngine({
      storage: storage || makeStorage(),
      providers: { getProvider: () => scriptedProvider },
      toolRegistry: toolRegistry || makeToolRegistry(),
      path,
      maxToolRounds: 3,
      clock: () => 1234,
    }),
  };
}

test('engine streams contract events and returns a chat result without Electron', async () => {
  const { engine, calls } = makeEngine([
    assistantText('Hallo!', { usage: { prompt: 10, completion: 2, total: 12 } }),
  ]);
  const events = [];

  const result = await engine.send({
    sessionId: 'renderer-1',
    payload: { messages: [{ role: 'user', content: 'Hi' }] },
    onEvent: (event) => events.push(event),
  });

  assert.equal(result.content, 'Hallo!');
  assert.deepEqual(result.usage, { prompt: 10, completion: 2, total: 12 });
  assert.equal(result.rawExchanges[0].ts, 1234);
  assert.equal(calls.length, 1);
  assert.deepEqual(events.map((event) => event.type), [
    CHAT_ENGINE_EVENTS.PROGRESS,
    CHAT_ENGINE_EVENTS.PROGRESS,
  ]);
  assert.deepEqual(events.map((event) => event.payload.phase), ['waiting', 'idle']);
});

test('engine runs the tool loop and emits tool events through its event sink', async () => {
  const toolRegistry = makeToolRegistry(() => JSON.stringify({ items: ['README.md'] }));
  const { engine, calls } = makeEngine([
    assistantToolCall('call_1', 'list_directory', { relative_path: '.' }),
    assistantText('Im Ordner liegt README.md.'),
  ], { toolRegistry });
  const events = [];

  const result = await engine.send({
    sessionId: 'renderer-1',
    payload: {
      messages: [{ role: 'user', content: 'Was liegt hier?' }],
      workspaceRoot: '/tmp/weyouze-project',
    },
    onEvent: (event) => events.push(event),
  });

  assert.equal(result.content, 'Im Ordner liegt README.md.');
  assert.equal(toolRegistry.calls.length, 1);
  assert.deepEqual(toolRegistry.calls[0].args, { relative_path: '.' });
  assert.equal(result.rawExchanges.length, 2);
  assert.equal(calls[1].messages.find((message) => message.role === 'tool').tool_call_id, 'call_1');
  const toolEvents = events.filter((event) => event.type === CHAT_ENGINE_EVENTS.TOOL_LINE);
  assert.deepEqual(toolEvents.map((event) => event.payload.phase), ['start', 'done']);
});

test('engine aborts only the targeted in-flight session', async () => {
  const provider = {
    defaultModel: 'test-model',
    fields: {},
    streamChatRound: ({ abortSignal }) => new Promise((resolve) => {
      const finish = () => resolve({ cancelled: true, message: { role: 'assistant', content: '' } });
      if (abortSignal.aborted) return finish();
      abortSignal.addEventListener('abort', finish, { once: true });
    }),
  };
  const { engine } = makeEngine([], { provider });

  const pending = engine.send({
    sessionId: 'renderer-1',
    payload: { messages: [{ role: 'user', content: 'Hi' }] },
  });
  engine.abort('renderer-1');

  const result = await pending;
  assert.equal(result.cancelled, true);
});

test('engine turns provider failures into the existing error DTO', async () => {
  const { engine } = makeEngine([{ error: 'Kontingent erschöpft', code: 'RATE_LIMIT' }]);

  const result = await engine.send({
    sessionId: 'renderer-1',
    payload: { messages: [{ role: 'user', content: 'Hi' }] },
  });

  assert.deepEqual(result, {
    error: 'Kontingent erschöpft',
    code: 'RATE_LIMIT',
    usage: null,
    rawExchanges: result.rawExchanges,
  });
  assert.equal(result.rawExchanges.length, 1);
});

test('engine explain keeps tools and raw recording out of the provider call', async () => {
  const { engine, calls } = makeEngine([assistantText('Erklärung.')]);

  const result = await engine.explain({
    payload: { messages: [{ role: 'user', content: 'Erkläre das Protokoll.' }] },
  });

  assert.deepEqual(result, { content: 'Erklärung.' });
  assert.equal(calls[0].tools, undefined);
  assert.equal(calls[0].recorder, undefined);
});
