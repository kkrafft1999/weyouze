const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createChatEngine, CHAT_ENGINE_EVENTS } = require('../src/application/chat/chat-engine');

function makeMockRecorder() {
  return {
    request() {},
    onRawLine() {},
    toExchange(meta) {
      return { ...meta, request: null, responseRaw: '' };
    },
  };
}

function makeToolPort(execute) {
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

function makeWorkspacePaths() {
  return {
    resolveRoot(rawRoot) {
      if (typeof rawRoot !== 'string' || !rawRoot.trim()) return null;
      return path.resolve(rawRoot.trim());
    },
    resolveSelection(root, selectedPath, selectedIsDirectory) {
      if (!root || typeof selectedPath !== 'string' || !selectedPath.trim()) return null;
      const trimmed = selectedPath.trim();
      const absolutePath = path.isAbsolute(trimmed)
        ? path.resolve(trimmed)
        : path.resolve(root, trimmed);
      const relativePath = path.relative(root, absolutePath);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;
      return { relativePath: relativePath || '.', isDirectory: !!selectedIsDirectory };
    },
    basename: (absPath) => path.basename(absPath),
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

function makeLlmPort(results, {
  resolveResult = { providerId: 'test', model: 'test-model' },
  validateResult = null,
  sendBundle = null,
} = {}) {
  let resultIndex = 0;
  const calls = [];
  const bundleCalls = [];
  const port = {
    calls,
    bundleCalls,
    async resolveChatTarget() {
      if (resolveResult?.error) return resolveResult;
      return typeof resolveResult === 'function' ? resolveResult() : resolveResult;
    },
    async validateTarget() {
      return validateResult;
    },
    async prepareSendBundle(target) {
      bundleCalls.push(target);
      if (sendBundle) return sendBundle;
      return { config: { apiKey: 'test' }, model: target.model || 'test-model' };
    },
    async streamRound(params) {
      calls.push(params);
      const result = typeof results === 'function'
        ? results(params, resultIndex)
        : results[Math.min(resultIndex, results.length - 1)];
      resultIndex += 1;
      return result;
    },
    formatRoundError(err) {
      return err?.message || String(err);
    },
  };
  return port;
}

function makeEngine(results, {
  llm,
  tools,
  preferences,
  workspacePaths,
  maxToolRounds = 3,
} = {}) {
  const llmPort = llm || makeLlmPort(results);
  return {
    calls: llmPort.calls,
    tools: tools || makeToolPort(),
    engine: createChatEngine({
      llm: llmPort,
      tools: tools || makeToolPort(),
      preferences: preferences || { async read() { return {}; } },
      workspacePaths: workspacePaths || makeWorkspacePaths(),
      rawExchange: { createRoundRecorder: makeMockRecorder },
      maxToolRounds,
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

test('engine validates provider configuration before streaming', async () => {
  const { engine, calls } = makeEngine([assistantText('unused')], {
    llm: makeLlmPort([assistantText('unused')], {
      resolveResult: {
        error: 'Unbekannter Provider: ghost.',
        code: 'INVALID',
      },
    }),
  });

  const result = await engine.send({
    sessionId: 'renderer-1',
    payload: { messages: [{ role: 'user', content: 'Hi' }] },
  });

  assert.equal(result.code, 'INVALID');
  assert.match(result.error, /Unbekannter Provider: ghost/);
  assert.equal(calls.length, 0);
});

test('engine rejects a missing required API key without streaming', async () => {
  const { engine, calls } = makeEngine([assistantText('unused')], {
    llm: makeLlmPort([assistantText('unused')], {
      validateResult: {
        error: 'Kein API-Key für Test hinterlegt. Bitte in den Einstellungen speichern.',
        code: 'NO_API_KEY',
      },
    }),
  });

  const result = await engine.send({
    sessionId: 'renderer-1',
    payload: { messages: [{ role: 'user', content: 'Hi' }] },
  });

  assert.equal(result.code, 'NO_API_KEY');
  assert.equal(calls.length, 0);
});

test('engine forwards providerOptions without provider-specific branching', async () => {
  const seen = [];
  const llm = makeLlmPort([assistantText('ok')], {
    resolveResult: {
      providerId: 'anthropic',
      model: 'claude-test',
      providerOptions: { reasoningEffort: 'high' },
    },
  });
  llm.streamRound = async (params) => {
    seen.push(params.target);
    return assistantText('ok');
  };

  const { engine } = makeEngine([], { llm });
  await engine.send({
    sessionId: 'renderer-1',
    payload: { messages: [{ role: 'user', content: 'Hi' }] },
  });

  assert.deepEqual(seen[0].providerOptions, { reasoningEffort: 'high' });
  assert.equal(seen[0].providerId, 'anthropic');
});

test('engine reuses per-send bundle across tool rounds', async () => {
  const bundle = { config: { apiKey: 'snap' }, model: 'snap-model' };
  const llm = makeLlmPort([
    assistantToolCall('call_1', 'list_directory', { relative_path: '.' }),
    assistantText('done'),
  ], { sendBundle: bundle });

  const { engine } = makeEngine([], { llm });
  await engine.send({
    sessionId: 'renderer-1',
    payload: {
      messages: [{ role: 'user', content: 'Hi' }],
      workspaceRoot: '/tmp/weyouze-project',
    },
  });

  assert.equal(llm.bundleCalls.length, 1);
  assert.equal(llm.calls.length, 2);
  assert.equal(llm.calls[0].sendBundle, bundle);
  assert.equal(llm.calls[1].sendBundle, bundle);
});

test('engine runs the tool loop and emits tool events through its event sink', async () => {
  const tools = makeToolPort(() => JSON.stringify({ items: ['README.md'] }));
  const { engine, calls } = makeEngine([
    assistantToolCall('call_1', 'list_directory', { relative_path: '.' }),
    assistantText('Im Ordner liegt README.md.'),
  ], { tools });
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
  assert.equal(tools.calls.length, 1);
  assert.deepEqual(tools.calls[0].args, { relative_path: '.' });
  assert.equal(result.rawExchanges.length, 2);
  assert.equal(calls[1].messages.find((message) => message.role === 'tool').tool_call_id, 'call_1');
  const toolEvents = events.filter((event) => event.type === CHAT_ENGINE_EVENTS.TOOL_LINE);
  assert.deepEqual(toolEvents.map((event) => event.payload.phase), ['start', 'done']);
});

test('engine supplies a synthetic tool error when no workspace is open', async () => {
  const tools = makeToolPort();
  const { engine, calls } = makeEngine([
    assistantToolCall('call_1', 'list_directory', { relative_path: '.' }),
    assistantText('Kein Arbeitsordner offen.'),
  ], { tools });

  const result = await engine.send({
    sessionId: 'renderer-1',
    payload: { messages: [{ role: 'user', content: 'Liste Dateien' }] },
  });

  assert.equal(result.content, 'Kein Arbeitsordner offen.');
  assert.equal(tools.calls.length, 0);
  assert.equal(result.toolTrace[0].noWorkspace, true);
  const toolMessage = calls[1].messages.find((message) => message.role === 'tool');
  assert.match(toolMessage.content, /Kein Arbeitsordner geöffnet/);
});

test('engine preserves debug_wait metadata in its tool trace', async () => {
  const { engine } = makeEngine([
    assistantToolCall('call_1', 'debug_wait', { duration_seconds: 0.1 }),
    assistantText('Fertig.'),
  ]);

  const result = await engine.send({
    sessionId: 'renderer-1',
    payload: {
      messages: [{ role: 'user', content: 'Warte' }],
      workspaceRoot: '/tmp/weyouze-project',
    },
  });

  assert.equal(result.content, 'Fertig.');
  assert.equal(result.toolTrace[0].waitMs, 500);
});

test('engine stops at its configured tool-round limit', async () => {
  const { engine } = makeEngine(() =>
    assistantToolCall('call_1', 'list_directory', { relative_path: '.' })
  );

  const result = await engine.send({
    sessionId: 'renderer-1',
    payload: {
      messages: [{ role: 'user', content: 'Liste endlos' }],
      workspaceRoot: '/tmp/weyouze-project',
    },
  });

  assert.equal(result.code, 'TOOL_LIMIT', result.error);
  assert.equal(result.rawExchanges.length, 3);
});

test('engine emits delta and reasoning events from provider callbacks', async () => {
  const llm = makeLlmPort([]);
  llm.streamRound = async ({ callbacks }) => {
    callbacks.onTextDelta('Teil');
    callbacks.onReasoningDelta('Gedanke');
    return assistantText('Teil');
  };
  const { engine } = makeEngine([], { llm });
  const events = [];

  await engine.send({
    sessionId: 'renderer-1',
    payload: { messages: [{ role: 'user', content: 'Hi' }] },
    onEvent: (event) => events.push(event),
  });

  assert.deepEqual(events.filter((event) => event.type === CHAT_ENGINE_EVENTS.DELTA).map((event) => event.payload), [
    { text: 'Teil' },
  ]);
  assert.deepEqual(events.filter((event) => event.type === CHAT_ENGINE_EVENTS.PROGRESS).map((event) => event.payload), [
    { type: 'phase', phase: 'waiting' },
    { type: 'phase', phase: 'generating' },
    { type: 'reasoning', text: 'Gedanke' },
    { type: 'phase', phase: 'idle' },
  ]);
});

test('engine passes the write preference to its tool registry', async () => {
  const getToolsCalls = [];
  const tools = makeToolPort();
  tools.getTools = (options) => {
    getToolsCalls.push(options);
    return [{ type: 'function', function: { name: options.allowWrite ? 'write_file_text' : 'list_directory' } }];
  };
  const { engine, calls } = makeEngine([assistantText('ok')], {
    tools,
    preferences: { async read() { return { allowWorkspaceWrite: true }; } },
  });

  await engine.send({
    sessionId: 'renderer-1',
    payload: {
      messages: [{ role: 'user', content: 'Hi' }],
      workspaceRoot: '/tmp/weyouze-project',
    },
  });

  assert.deepEqual(getToolsCalls, [{ allowWrite: true }]);
  assert.equal(calls[0].tools[0].function.name, 'write_file_text');
});

test('engine aborts only the targeted in-flight session', async () => {
  const llm = makeLlmPort([]);
  llm.streamRound = ({ abortSignal }) =>
    new Promise((resolve) => {
      const finish = () => resolve({ cancelled: true, message: { role: 'assistant', content: '' } });
      if (abortSignal.aborted) return finish();
      abortSignal.addEventListener('abort', finish, { once: true });
    });
  const { engine } = makeEngine([], { llm });

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
