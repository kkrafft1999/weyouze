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

// ---------------------------------------------------------------------------
// Integration-Test-Harness fuer registerChatHandlers: baut minimale, aber
// realistische Stubs fuer ipcMain/storage/providers/fsService, damit der
// komplette Tool-Use-Loop (nicht nur einzelne Hilfsfunktionen) abgedeckt ist.
// ---------------------------------------------------------------------------

function makeIpcMain() {
  const handlers = new Map();
  const onHandlers = new Map();
  return {
    handlers,
    onHandlers,
    handle(channel, fn) { handlers.set(channel, fn); },
    on(channel, fn) { onHandlers.set(channel, fn); },
  };
}

function makeFakeEvent(id = 1) {
  const sent = [];
  return {
    sent,
    event: {
      sender: {
        id,
        isDestroyed: () => false,
        send: (channel, payload) => sent.push({ channel, payload }),
      },
    },
  };
}

function makeScriptedProvider(results, { fields = {}, defaultModel = 'test-model' } = {}) {
  const calls = [];
  let i = 0;
  return {
    provider: {
      defaultModel,
      fields,
      async streamChatRound(args) {
        calls.push(args);
        const result = typeof results === 'function' ? results(args, calls.length - 1) : results[Math.min(i, results.length - 1)];
        i += 1;
        return result;
      },
    },
    calls,
  };
}

function makeStorage(overrides = {}) {
  return {
    readLLMConfig: async () => ({}),
    resolveChatModelTarget: () => ({ providerId: 'test' }),
    getEffectiveProviderConfig: async () => ({ apiKey: 'sk-test' }),
    readUIPrefs: async () => ({}),
    ...overrides,
  };
}

function makeFsServiceStub(impl) {
  const calls = [];
  return {
    calls,
    async runWorkspaceTool(toolName, args, workspaceRoot, options) {
      calls.push({ toolName, args, workspaceRoot, options });
      if (impl) return impl(toolName, args, workspaceRoot, options);
      return JSON.stringify({ ok: true });
    },
  };
}

function assistantText(content, extra) {
  return { message: { role: 'assistant', content }, finishReason: 'stop', usage: null, ...extra };
}

function assistantToolCall(toolCalls, extra) {
  return {
    message: { role: 'assistant', content: null, tool_calls: toolCalls },
    finishReason: 'tool_calls',
    usage: null,
    ...extra,
  };
}

function toolCall(id, name, args) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function setupChatHandlers({
  provider,
  storage = makeStorage(),
  fsService = makeFsServiceStub(),
  workspaceTools = [{ type: 'function', function: { name: 'list_directory' } }],
  writeWorkspaceTools,
  maxToolRounds = 5,
} = {}) {
  const ipcMain = makeIpcMain();
  registerChatHandlers({
    ipcMain,
    storage,
    providers: { getProvider: () => provider },
    fsService,
    path,
    defaultProviderId: 'test',
    maxToolRounds,
    workspaceTools,
    writeWorkspaceTools,
    REQ,
    PUSH,
  });
  return {
    sendHandler: ipcMain.handlers.get(REQ.CHAT_SEND),
    explainHandler: ipcMain.handlers.get(REQ.CHAT_EXPLAIN),
    abortHandler: ipcMain.onHandlers.get(REQ.CHAT_ABORT),
    fsService,
  };
}

test('CHAT_SEND rejects an empty messages payload', async () => {
  const { provider } = makeScriptedProvider([assistantText('unused')]);
  const { sendHandler } = setupChatHandlers({ provider });
  const { event } = makeFakeEvent();

  const res = await sendHandler(event, { messages: [] });
  assert.deepEqual(res, { error: 'Keine Nachrichten übergeben.', code: 'INVALID' });
});

test('CHAT_SEND reports an unknown provider without calling streamChatRound', async () => {
  const { provider, calls } = makeScriptedProvider([assistantText('unused')]);
  const storage = makeStorage({ resolveChatModelTarget: () => ({ providerId: 'ghost' }) });
  const ipcMain = makeIpcMain();
  registerChatHandlers({
    ipcMain,
    storage,
    providers: { getProvider: () => null },
    fsService: makeFsServiceStub(),
    path,
    defaultProviderId: 'test',
    maxToolRounds: 5,
    workspaceTools: [],
    REQ,
    PUSH,
  });
  const { event } = makeFakeEvent();

  const res = await ipcMain.handlers.get(REQ.CHAT_SEND)(event, { messages: [{ role: 'user', content: 'Hi' }] });
  assert.equal(res.code, 'INVALID');
  assert.match(res.error, /Unbekannter Provider/);
  assert.equal(calls.length, 0);
});

test('CHAT_SEND fails fast when the API key is missing', async () => {
  const { provider, calls } = makeScriptedProvider([assistantText('unused')], { fields: { apiKey: true } });
  const storage = makeStorage({ getEffectiveProviderConfig: async () => ({}) });
  const { sendHandler } = setupChatHandlers({ provider, storage });
  const { event } = makeFakeEvent();

  const res = await sendHandler(event, { messages: [{ role: 'user', content: 'Hi' }] });
  assert.equal(res.code, 'NO_API_KEY');
  assert.equal(calls.length, 0);
});

test('CHAT_SEND fails fast when a required base URL is missing', async () => {
  const { provider, calls } = makeScriptedProvider([assistantText('unused')], { fields: { baseUrl: true } });
  const storage = makeStorage({ getEffectiveProviderConfig: async () => ({}) });
  const { sendHandler } = setupChatHandlers({ provider, storage });
  const { event } = makeFakeEvent();

  const res = await sendHandler(event, { messages: [{ role: 'user', content: 'Hi' }] });
  assert.equal(res.code, 'NO_BASE_URL');
  assert.equal(calls.length, 0);
});

test('CHAT_SEND returns the final assistant text when no tools are called', async () => {
  const { provider } = makeScriptedProvider([
    assistantText('Hallo!', { usage: { prompt: 10, completion: 2, total: 12 } }),
  ]);
  const { sendHandler } = setupChatHandlers({ provider });
  const { event } = makeFakeEvent();

  const res = await sendHandler(event, { messages: [{ role: 'user', content: 'Hi' }] });
  assert.equal(res.content, 'Hallo!');
  assert.deepEqual(res.toolTrace, []);
  assert.deepEqual(res.usage, { prompt: 10, completion: 2, total: 12 });
  assert.equal(res.rawExchanges.length, 1);
});

test('CHAT_SEND runs a full tool round-trip: tool call -> fsService -> follow-up answer', async () => {
  const { provider, calls } = makeScriptedProvider([
    assistantToolCall([toolCall('call_1', 'list_directory', { relative_path: '.' })]),
    assistantText('Im Ordner liegen 3 Dateien.'),
  ]);
  const fsService = makeFsServiceStub((toolName, args) =>
    JSON.stringify({ relative_path: args.relative_path, items: [] })
  );
  const { sendHandler } = setupChatHandlers({ provider, fsService });
  const { event, sent } = makeFakeEvent();

  const res = await sendHandler(event, {
    messages: [{ role: 'user', content: 'Was liegt hier?' }],
    workspaceRoot: '/tmp/weyouze-project',
  });

  assert.equal(res.content, 'Im Ordner liegen 3 Dateien.');
  assert.equal(res.toolTrace.length, 1);
  assert.equal(res.toolTrace[0].tool, 'list_directory');
  assert.equal(res.rawExchanges.length, 2);

  assert.equal(fsService.calls.length, 1);
  assert.equal(fsService.calls[0].toolName, 'list_directory');
  assert.deepEqual(fsService.calls[0].args, { relative_path: '.' });
  assert.equal(fsService.calls[0].workspaceRoot, path.resolve('/tmp/weyouze-project'));

  // Zweite Runde muss die Tool-Antwort als 'tool'-Message an den Provider senden.
  const secondRoundMessages = calls[1].messages;
  const toolMsg = secondRoundMessages.find((m) => m.role === 'tool');
  assert.ok(toolMsg, 'tool response message must be forwarded to the next round');
  assert.equal(toolMsg.tool_call_id, 'call_1');
  assert.deepEqual(JSON.parse(toolMsg.content), { relative_path: '.', items: [] });

  // Start/Done-Ereignisse werden als Rohdaten an den Renderer gepusht.
  const toolLineEvents = sent.filter((s) => s.channel === PUSH.CHAT_TOOL_LINE);
  assert.deepEqual(toolLineEvents.map((e) => e.payload.phase), ['start', 'done']);
});

test('CHAT_SEND rejects tool calls with a synthetic error when no workspace is open', async () => {
  const { provider, calls } = makeScriptedProvider([
    assistantToolCall([toolCall('call_1', 'list_directory', { relative_path: '.' })]),
    assistantText('Kein Ordner offen, aber hier ist eine Antwort.'),
  ]);
  const fsService = makeFsServiceStub();
  const { sendHandler } = setupChatHandlers({ provider, fsService });
  const { event } = makeFakeEvent();

  const res = await sendHandler(event, {
    messages: [{ role: 'user', content: 'ls' }],
    // kein workspaceRoot
  });

  assert.equal(res.content, 'Kein Ordner offen, aber hier ist eine Antwort.');
  assert.equal(fsService.calls.length, 0, 'fsService must never be invoked without an open workspace');
  assert.equal(res.toolTrace[0].noWorkspace, true);

  const toolMsg = calls[1].messages.find((m) => m.role === 'tool');
  assert.match(toolMsg.content, /Kein Arbeitsordner geöffnet/);
});

test('CHAT_SEND attaches the clamped debug_wait duration to the tool trace entry', async () => {
  const { provider } = makeScriptedProvider([
    assistantToolCall([toolCall('call_1', 'debug_wait', { duration_seconds: 0.1 })]),
    assistantText('fertig'),
  ]);
  const fsService = makeFsServiceStub(() => JSON.stringify({ ok: true, waited_ms: 500 }));
  const { sendHandler } = setupChatHandlers({ provider, fsService });
  const { event } = makeFakeEvent();

  const res = await sendHandler(event, {
    messages: [{ role: 'user', content: 'warte kurz' }],
    workspaceRoot: '/tmp/weyouze-project',
  });

  // duration_seconds: 0.1 liegt unter dem Minimum (500ms) und wird geclampt.
  assert.equal(res.toolTrace[0].waitMs, 500);
});

test('CHAT_SEND stops with TOOL_LIMIT once the configured round limit is exhausted', async () => {
  const { provider } = makeScriptedProvider(() =>
    assistantToolCall([toolCall(`call_${Math.random()}`, 'list_directory', { relative_path: '.' })])
  );
  const { sendHandler } = setupChatHandlers({ provider, maxToolRounds: 2 });
  const { event } = makeFakeEvent();

  const res = await sendHandler(event, {
    messages: [{ role: 'user', content: 'ls endlos' }],
    workspaceRoot: '/tmp/weyouze-project',
  });

  assert.equal(res.code, 'TOOL_LIMIT');
  assert.match(res.error, /Zu viele Tool-Runden/);
  assert.equal(res.rawExchanges.length, 2);
});

test('CHAT_SEND surfaces a provider error mid-loop and stops further rounds', async () => {
  const { provider, calls } = makeScriptedProvider([
    { error: 'Kontingent erschöpft', code: 'RATE_LIMIT' },
    assistantText('sollte nie erreicht werden'),
  ]);
  const { sendHandler } = setupChatHandlers({ provider });
  const { event } = makeFakeEvent();

  const res = await sendHandler(event, { messages: [{ role: 'user', content: 'Hi' }] });
  assert.equal(res.error, 'Kontingent erschöpft');
  assert.equal(res.code, 'RATE_LIMIT');
  assert.equal(calls.length, 1, 'the loop must not continue after a provider error');
});

test('CHAT_SEND returns a cancelled result with the partial text when the provider reports cancellation', async () => {
  const { provider } = makeScriptedProvider([
    { cancelled: true, message: { role: 'assistant', content: 'Teilantwort' } },
  ]);
  const { sendHandler } = setupChatHandlers({ provider });
  const { event, sent } = makeFakeEvent();

  const res = await sendHandler(event, { messages: [{ role: 'user', content: 'Hi' }] });
  assert.equal(res.cancelled, true);
  assert.equal(res.content, 'Teilantwort');
  const phases = sent.filter((s) => s.channel === PUSH.CHAT_PROGRESS).map((s) => s.payload.phase);
  assert.ok(phases.includes('idle'));
});

test('CHAT_ABORT cancels an in-flight CHAT_SEND for the same sender', async () => {
  const provider = {
    defaultModel: 'test-model',
    fields: {},
    streamChatRound: ({ abortSignal }) =>
      new Promise((resolve) => {
        const finish = () => resolve({ cancelled: true, message: { role: 'assistant', content: '' } });
        if (abortSignal.aborted) return finish();
        abortSignal.addEventListener('abort', finish, { once: true });
      }),
  };
  const { sendHandler, abortHandler } = setupChatHandlers({ provider });
  const { event } = makeFakeEvent(7);

  const pending = sendHandler(event, { messages: [{ role: 'user', content: 'Hi' }] });
  abortHandler({ sender: { id: 7 } });
  const res = await pending;

  assert.equal(res.cancelled, true);
});

test('CHAT_EXPLAIN returns the provider content without recording tools or a raw log', async () => {
  const { provider, calls } = makeScriptedProvider([assistantText('Erklärung des Ablaufs.')]);
  const storage = makeStorage();
  const ipcMain = makeIpcMain();
  registerChatHandlers({
    ipcMain,
    storage,
    providers: { getProvider: () => provider },
    fsService: makeFsServiceStub(),
    path,
    defaultProviderId: 'test',
    maxToolRounds: 5,
    workspaceTools: [{ type: 'function', function: { name: 'list_directory' } }],
    REQ,
    PUSH,
  });

  const res = await ipcMain.handlers.get(REQ.CHAT_EXPLAIN)(null, {
    messages: [{ role: 'user', content: 'Erkläre das RAW-Protokoll.' }],
  });

  assert.equal(res.content, 'Erklärung des Ablaufs.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].tools, undefined);
  assert.equal(calls[0].recorder, undefined);
});

test('CHAT_EXPLAIN rejects an empty messages payload', async () => {
  const { provider } = makeScriptedProvider([assistantText('unused')]);
  const { explainHandler } = setupChatHandlers({ provider });

  const res = await explainHandler(null, { messages: [] });
  assert.deepEqual(res, { error: 'Keine Nachrichten übergeben.', code: 'INVALID' });
});

test('CHAT_EXPLAIN surfaces provider errors with their code', async () => {
  const { provider } = makeScriptedProvider([{ error: 'Ungültiges Modell', code: 'INVALID_MODEL' }]);
  const { explainHandler } = setupChatHandlers({ provider });

  const res = await explainHandler(null, { messages: [{ role: 'user', content: 'Hi' }] });
  assert.deepEqual(res, { error: 'Ungültiges Modell', code: 'INVALID_MODEL' });
});

test('CHAT_SEND omits write_file_text from tools when allowWorkspaceWrite is false', async () => {
  const { provider, calls } = makeScriptedProvider([assistantText('ok')]);
  const storage = makeStorage({ readUIPrefs: async () => ({ allowWorkspaceWrite: false }) });
  const { sendHandler } = setupChatHandlers({
    provider,
    storage,
    writeWorkspaceTools: [{ type: 'function', function: { name: 'write_file_text' } }],
  });
  const { event } = makeFakeEvent();

  const res = await sendHandler(event, {
    messages: [{ role: 'user', content: 'Hallo' }],
    workspaceRoot: '/tmp/weyouze-test-project',
  });

  const tools = calls[0].tools;
  assert.ok(Array.isArray(tools));
  assert.equal(tools.some((t) => t.function.name === 'write_file_text'), false);
  assert.equal(tools.some((t) => t.function.name === 'list_directory'), true);

  const sentSystemMessage = res.rawExchanges[0].messages[0];
  assert.equal(sentSystemMessage.role, 'system');
  assert.doesNotMatch(sentSystemMessage.content, /write_file_text/);
});

test('CHAT_SEND includes write_file_text in tools when allowWorkspaceWrite is true', async () => {
  const { provider, calls } = makeScriptedProvider([assistantText('ok')]);
  const storage = makeStorage({ readUIPrefs: async () => ({ allowWorkspaceWrite: true }) });
  const { sendHandler } = setupChatHandlers({
    provider,
    storage,
    writeWorkspaceTools: [{ type: 'function', function: { name: 'write_file_text' } }],
  });
  const { event } = makeFakeEvent();

  const res = await sendHandler(event, {
    messages: [{ role: 'user', content: 'Hallo' }],
    workspaceRoot: '/tmp/weyouze-test-project',
  });

  const tools = calls[0].tools;
  assert.ok(tools.some((t) => t.function.name === 'write_file_text'));

  const sentSystemMessage = res.rawExchanges[0].messages[0];
  assert.match(sentSystemMessage.content, /write_file_text/);
});
