const test = require('node:test');
const assert = require('node:assert/strict');
const anthropic = require('../src/main/providers/anthropic');
const google = require('../src/main/providers/google');
const ollama = require('../src/main/providers/ollama');
const { safeJsonParse } = require('../src/main/providers/stream-helpers');

test('safeJsonParse returns fallback for invalid input', () => {
  assert.deepEqual(safeJsonParse('', { ok: true }), { ok: true });
  assert.deepEqual(safeJsonParse('{bad', { ok: true }), { ok: true });
  assert.deepEqual(safeJsonParse('{"a":1}', {}), { a: 1 });
});

test('translateMessagesToAnthropic merges system and batches tool results', () => {
  const { system, messages } = anthropic.translateMessagesToAnthropic([
    { role: 'system', content: 'Be helpful' },
    { role: 'user', content: 'List files' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'tc1', function: { name: 'list_directory', arguments: '{"relative_path":"."}' } }],
    },
    { role: 'tool', tool_call_id: 'tc1', content: '{"items":[]}' },
    { role: 'user', content: 'Thanks' },
  ]);

  assert.equal(system, 'Be helpful');
  assert.equal(messages.length, 4);
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].content[0].type, 'tool_use');
  assert.equal(messages[2].role, 'user');
  assert.equal(messages[2].content[0].type, 'tool_result');
  assert.equal(messages[3].content, 'Thanks');
});

test('translateToolsToAnthropic skips invalid entries', () => {
  const tools = anthropic.translateToolsToAnthropic([
    { function: { name: 'list_directory', description: 'List', parameters: { type: 'object' } } },
    { function: { description: 'missing name' } },
  ]);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'list_directory');
});

test('translateMessagesToGoogle maps assistant tool calls and tool responses', () => {
  const { systemText, contents } = google.translateMessagesToGoogle([
    { role: 'system', content: 'Sys' },
    { role: 'user', content: 'Go' },
    {
      role: 'assistant',
      content: 'Calling tool',
      tool_calls: [{ id: 'tc1', function: { name: 'read_file_text', arguments: '{"relative_path":"a.txt"}' } }],
    },
    { role: 'tool', tool_call_id: 'tc1', content: '{"content":"hi"}' },
  ]);

  assert.equal(systemText, 'Sys');
  assert.equal(contents[1].role, 'model');
  assert.equal(contents[1].parts[1].functionCall.name, 'read_file_text');
  assert.equal(contents[2].parts[0].functionResponse.name, 'read_file_text');
});

test('translateMessagesToOllama parses tool call arguments', () => {
  const out = ollama.translateMessagesToOllama([
    { role: 'user', content: 'Hi' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name: 'list_directory', arguments: '{"relative_path":"src"}' } }],
    },
    { role: 'tool', content: 'done' },
  ]);

  assert.equal(out[1].tool_calls[0].function.arguments.relative_path, 'src');
  assert.equal(out[2].role, 'tool');
});
