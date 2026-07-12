const test = require('node:test');
const assert = require('node:assert/strict');
const { attachRawLogTurn } = require('../src/shared/contracts/raw-log');
const { createRawLogPresentationService } = require('../src/main/services/raw-log-presentation-service');

const svc = createRawLogPresentationService();

function makeExchange(overrides = {}) {
  return {
    model: 'test-model',
    ts: 1_700_000_000_000,
    messages: [{ role: 'user', content: 'Hallo' }],
    request: {
      method: 'POST',
      url: 'https://api.example.com/v1/chat',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test-model', messages: [{ role: 'user', content: 'Hallo' }] }),
    },
    response: { text: 'Hi!', toolCalls: [] },
    responseRaw: 'data: {"choices":[{"message":{"content":"Hi!"}}]}',
    finishReason: 'stop',
    usage: { prompt: 12, completion: 3, total: 15 },
    ...overrides,
  };
}

test('extractToolDefs parses OpenAI, Ollama/MLX, Google, and Anthropic tool schema shapes', () => {
  const openai = svc.extractToolDefs({
    tools: [{ type: 'function', function: { name: 'list_directory', parameters: { type: 'object' } } }],
  });
  assert.equal(openai.length, 1);
  assert.equal(openai[0].name, 'list_directory');

  const ollama = svc.extractToolDefs({
    tools: [{ name: 'read_file_text', description: 'read', parameters: { type: 'object' } }],
  });
  assert.equal(ollama.length, 1);
  assert.equal(ollama[0].name, 'read_file_text');

  const google = svc.extractToolDefs({
    tools: [
      {
        functionDeclarations: [
          { name: 'write_file_text', description: 'write' },
          { name: 'debug_wait', description: 'wait' },
        ],
      },
    ],
  });
  assert.deepEqual(google.map((d) => d.name), ['write_file_text', 'debug_wait']);

  const anthropic = svc.extractToolDefs({
    tools: [
      {
        name: 'list_directory',
        description: 'List files',
        input_schema: { type: 'object', properties: { relative_path: { type: 'string' } } },
      },
    ],
  });
  assert.equal(anthropic.length, 1);
  assert.equal(anthropic[0].name, 'list_directory');
  assert.ok(anthropic[0].schema.input_schema);
});

test('normalizeMessageContent handles strings, arrays, and objects safely', () => {
  assert.equal(svc.normalizeMessageContent('plain'), 'plain');
  assert.equal(
    svc.normalizeMessageContent([{ type: 'text', text: 'part A' }, { type: 'text', text: 'part B' }]),
    'part A\npart B'
  );
  assert.equal(svc.normalizeMessageContent({ ok: true }), '{\n  "ok": true\n}');
  assert.equal(svc.normalizeMessageContent(null), '');
});

test('requestToolChoice and requestMaxTokens read provider-specific request fields', () => {
  assert.equal(svc.requestToolChoice({ tool_choice: 'auto' }), 'auto');
  assert.equal(svc.requestToolChoice({ tool_choice: { type: 'function' } }), 'function');
  assert.equal(svc.requestMaxTokens({ max_tokens: 1024 }), 1024);
  assert.equal(svc.requestMaxTokens({ generationConfig: { maxOutputTokens: 512 } }), 512);
});

test('describeFinishReason maps provider finish reasons to German labels', () => {
  assert.deepEqual(svc.describeFinishReason('tool_use', false), {
    text: 'Tool-Wunsch → weitere Runde nötig',
    kind: 'tool',
  });
  assert.deepEqual(svc.describeFinishReason('length', false), {
    text: 'abgeschnitten — Output-Limit erreicht',
    kind: 'warn',
  });
});

test('buildRoundDetailVm links answer tool calls by callId and callIndex when names duplicate', () => {
  const ex = makeExchange({
    response: {
      text: '',
      toolCalls: [
        { id: 'call_a', name: 'list_directory', arguments: '{"relative_path":"src"}' },
        { id: 'call_b', name: 'list_directory', arguments: '{"relative_path":"test"}' },
      ],
    },
    finishReason: 'tool_calls',
  });

  const vm = svc.buildRoundDetailVm(ex, 1, 0);
  assert.equal(vm.answer.toolCalls.length, 2);
  assert.equal(vm.answer.toolCalls[0].callId, 'call_a');
  assert.equal(vm.answer.toolCalls[0].callIndex, 0);
  assert.equal(vm.answer.toolCalls[1].callId, 'call_b');
  assert.equal(vm.answer.toolCalls[1].callIndex, 1);
});

test('buildRoundDetailVm uses indices and metadata without embedding exchange payloads', () => {
  const ex = makeExchange({
    request: {
      method: 'POST',
      url: 'https://api.example.com/v1/chat',
      headers: {},
      body: JSON.stringify({
        model: 'gpt-test',
        tool_choice: 'required',
        max_tokens: 800,
      }),
    },
    finishReason: 'length',
    response: { text: '', toolCalls: [] },
  });

  const vm = svc.buildRoundDetailVm(ex, 1, 0);
  assert.equal(vm.exchangeIndex, 0);
  assert.deepEqual(vm.newMessageIndices, [0]);
  assert.equal(vm.hasRawSection, true);
  assert.match(vm.requestParamsLine, /tool_choice: required/);
  assert.match(vm.finishWarn, /abgeschnitten/);
  assert.equal(vm.raw, undefined);
  assert.equal(vm.clipboardRaw, undefined);
});

test('buildContextStackVm tracks growth with slim layer references', () => {
  const exchanges = [
    makeExchange({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'Was liegt hier?' },
      ],
      usage: { prompt: 100, completion: 10, total: 110 },
      response: {
        text: '',
        toolCalls: [{ id: 'call_1', name: 'list_directory', arguments: '{"relative_path":"."}' }],
      },
      finishReason: 'tool_calls',
      request: {
        method: 'POST',
        url: 'https://api.example.com/v1/chat',
        body: JSON.stringify({
          tools: [{ type: 'function', function: { name: 'list_directory' } }],
        }),
      },
    }),
    makeExchange({
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'Was liegt hier?' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', name: 'list_directory', arguments: '{"relative_path":"."}' }],
        },
        { role: 'tool', tool_call_id: 'call_1', content: '{"items":[]}' },
      ],
      usage: { prompt: 250, completion: 20, total: 270 },
      response: { text: '3 Dateien.', toolCalls: [] },
      finishReason: 'stop',
    }),
  ];

  const stack = svc.buildContextStackVm(exchanges);
  assert.match(stack.metaStat, /Kontext wächst/);
  assert.equal(stack.rounds[0].toolLayer.count, 1);
  assert.match(stack.rounds[0].toolLayer.schemasPretty, /list_directory/);
  assert.equal(stack.rounds[0].clipboardRaw, undefined);
  assert.equal(stack.rounds[0].layers[0].fullMessage, undefined);
  assert.equal(stack.rounds[0].layers[0].exchangeIndex, 0);
  assert.equal(stack.rounds[0].execStrips[0].resultRecorded, true);
  assert.match(stack.rounds[0].execStrips[0].resultText, /items/);
  assert.equal(stack.rounds[0].execStrips[0].callId, undefined);
});

test('buildContextStackVm bounds tool schema pretty text size', () => {
  const hugeSchema = { name: 'big', schema: { x: 'y'.repeat(20_000) } };
  const pretty = svc.buildToolSchemasPretty([hugeSchema, { name: 'small', schema: { a: 1 } }]);
  assert.ok(pretty.length <= 8_000);
  assert.match(pretty, /small/);
});

test('buildContextStackVm marks unrecorded exec results', () => {
  const exchanges = [
    makeExchange({
      response: {
        text: '',
        toolCalls: [{ id: 'orphan', name: 'list_directory', arguments: '{}' }],
      },
      finishReason: 'tool_calls',
    }),
  ];
  const stack = svc.buildContextStackVm(exchanges);
  assert.equal(stack.rounds[0].execStrips[0].resultRecorded, false);
  assert.equal(stack.rounds[0].execStrips[0].resultText, '');
});

test('payload budget: rawLogTurn includes bounded tool schemas but not full request bodies', () => {
  const toolBody = JSON.stringify({
    model: 'm',
    messages: [{ role: 'user', content: 'x'.repeat(15_000) }],
    tools: [{ type: 'function', function: { name: 'list_directory', parameters: { type: 'object' } } }],
  });
  const exchanges = [
    makeExchange({
      request: { method: 'POST', url: 'https://api.example.com', body: toolBody },
      response: {
        text: '',
        toolCalls: [{ id: 'c1', name: 'list_directory', arguments: '{"relative_path":"."}' }],
      },
      finishReason: 'tool_calls',
    }),
    makeExchange({
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
      ],
      response: { text: 'done', toolCalls: [] },
    }),
  ];
  const turn = svc.buildRawLogTurnView({ userText: 'Hi', exchanges });
  const turnJson = JSON.stringify(turn);
  assert.match(turnJson, /list_directory/);
  assert.ok(!turnJson.includes('x'.repeat(500)));
  assert.ok(turn.contextStack.rounds[0].toolLayer.schemasPretty.length < toolBody.length);
});

test('RawLogModal renderer has no request-body tool parsing or cross-exchange correlation helpers', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../src/renderer/components/RawLogModal.js'), 'utf8');
  assert.doesNotMatch(src, /toolsPrettyFromExchange/);
  assert.doesNotMatch(src, /findToolResult/);
  assert.doesNotMatch(src, /body\.tools/);
  assert.doesNotMatch(src, /tool_call_id/);
});

test('buildRawLogTurnView produces a slim serializable turn view model', () => {
  const exchanges = [makeExchange()];
  const turn = svc.buildRawLogTurnView({
    userText: 'Hallo',
    ts: exchanges[0].ts,
    exchanges,
    index: 1,
  });

  assert.equal(turn.userText, 'Hallo');
  assert.equal(turn.exchangeCount, 1);
  assert.equal(turn.rounds[0].answer.hasText, true);
  assert.equal(turn.exchanges, undefined);
});

test('enrichSendResult attaches rawLogTurn without duplicating rawExchanges inside it', () => {
  const marker = 'UNIQUE_RESPONSE_RAW_MARKER_12345';
  const exchanges = [makeExchange({ responseRaw: marker })];
  const result = {
    content: 'Hi!',
    toolTrace: [],
    usage: exchanges[0].usage,
    rawExchanges: exchanges,
  };
  const enriched = svc.enrichSendResult(result, {
    messages: [{ role: 'user', content: 'Hallo' }],
  });

  assert.equal(enriched.rawExchanges, exchanges);
  assert.ok(enriched.rawLogTurn);
  assert.equal(enriched.rawLogTurn.exchanges, undefined);
  assert.equal(enriched.rawLogTurn.userText, 'Hallo');

  const turnJson = JSON.stringify(enriched.rawLogTurn);
  assert.ok(!turnJson.includes(marker), 'rawLogTurn must not embed responseRaw payloads');
  assert.ok(!turnJson.includes(exchanges[0].request.body), 'rawLogTurn must not embed request bodies');
});

test('payload budget: rawLogTurn serialized size stays well below rawExchanges duplication', () => {
  const bigBody = 'x'.repeat(20_000);
  const bigResponse = 'y'.repeat(20_000);
  const exchanges = [
    makeExchange({
      request: {
        method: 'POST',
        url: 'https://api.example.com/v1/chat',
        body: bigBody,
      },
      responseRaw: bigResponse,
      messages: [{ role: 'user', content: bigBody }],
    }),
  ];
  const enriched = svc.enrichSendResult(
    { content: 'ok', rawExchanges: exchanges },
    { messages: [{ role: 'user', content: 'Hi' }] }
  );

  const exchangesSize = JSON.stringify(exchanges).length;
  const turnSize = JSON.stringify(enriched.rawLogTurn).length;
  assert.ok(turnSize < exchangesSize * 0.25, `turn=${turnSize} should be much smaller than exchanges=${exchangesSize}`);
  assert.ok(!JSON.stringify(enriched.rawLogTurn).includes(bigBody));
  assert.ok(!JSON.stringify(enriched.rawLogTurn).includes(bigResponse));
});

test('resolveExplainMessages supports legacy messages, slim semantic payload, and rawLogTurn compat', () => {
  const legacy = [{ role: 'user', content: 'Legacy prompt' }];
  assert.deepEqual(svc.resolveExplainMessages({ messages: legacy }), legacy);

  const exchanges = [makeExchange()];
  const slim = svc.resolveExplainMessages({ userText: 'Hi', exchanges });
  assert.equal(slim.length, 1);
  assert.match(slim[0].content, /Ursprüngliche Anfrage des Nutzers/);

  const turn = svc.buildRawLogTurnView({ userText: 'Hi', exchanges });
  const compat = svc.resolveExplainMessages({ rawLogTurn: { ...turn, exchanges } });
  assert.match(compat[0].content, /Ursprüngliche Anfrage des Nutzers/);

  assert.equal(svc.resolveExplainMessages({}), null);
});

test('buildExplanationPrompt handles non-string message content in exchanges', () => {
  const exchanges = [
    makeExchange({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Multimodal input' }] }],
      response: { text: 'Antwort', toolCalls: [] },
    }),
  ];
  const prompt = svc.buildExplanationPrompt({ userText: 'Multimodal input', exchanges });
  assert.match(prompt, /Multimodal input/);
});

test('attachRawLogTurn adds rawLogTurn without mutating rawExchanges', () => {
  const rawExchanges = [{ model: 'm' }];
  const result = { content: 'ok', rawExchanges };
  const rawLogTurn = { userText: 'Hi', exchangeCount: 1 };
  const out = attachRawLogTurn(result, rawLogTurn);
  assert.equal(out.rawExchanges, rawExchanges);
  assert.equal(out.rawLogTurn, rawLogTurn);
});
