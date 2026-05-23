const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveToolRoundLimit,
  summarizeToolCall,
  truncateToolLabel,
} = require('../src/main/ipc/chat-handlers');

test('resolveToolRoundLimit clamps to configured bounds', () => {
  assert.equal(resolveToolRoundLimit({}, 14), 14);
  assert.equal(resolveToolRoundLimit({ maxToolRounds: 0 }, 14), 1);
  assert.equal(resolveToolRoundLimit({ maxToolRounds: 9999 }, 14), 500);
  assert.equal(resolveToolRoundLimit({ maxToolRounds: 42.7 }, 14), 43);
});

test('summarizeToolCall formats workspace tools with start and done labels', () => {
  assert.equal(
    summarizeToolCall('list_directory', { relative_path: 'src/main' }, 'start'),
    'Ordner src/main wird durchsucht …'
  );
  assert.equal(
    summarizeToolCall('list_directory', { relative_path: 'src/main' }, 'done'),
    'Ordner src/main durchsucht'
  );
  assert.equal(summarizeToolCall('list_directory', { relative_path: '.' }, 'start'), 'Projektordner wird durchsucht …');
  assert.equal(summarizeToolCall('list_directory', { relative_path: '' }, 'done'), 'Projektordner durchsucht');
  assert.equal(
    summarizeToolCall('read_file_text', { relative_path: 'README.md' }, 'start'),
    'Datei README.md wird gelesen …'
  );
  assert.equal(
    summarizeToolCall('read_file_text', { relative_path: 'README.md' }, 'done'),
    'Datei README.md gelesen'
  );
  assert.equal(summarizeToolCall('read_file_text', {}, 'start'), 'Datei wird gelesen …');
  assert.equal(summarizeToolCall('debug_wait', {}, 'start'), 'Warte 5 Sekunden …');
  assert.equal(summarizeToolCall('debug_wait', {}, 'done'), '5 Sekunden gewartet');
  assert.equal(summarizeToolCall('debug_wait', { duration_seconds: 1.2 }, 'start'), 'Warte 1,2 Sekunden …');
  assert.equal(summarizeToolCall('debug_wait', { duration_seconds: 1 }, 'done'), '1 Sekunde gewartet');
  assert.equal(summarizeToolCall('unknown_tool', {}, 'start'), 'unknown_tool wird ausgeführt …');
  assert.equal(summarizeToolCall('unknown_tool', {}, 'done'), 'unknown_tool ausgeführt');
});

test('truncateToolLabel shortens long labels', () => {
  const long = 'a'.repeat(60);
  const out = truncateToolLabel(long, 20);
  assert.equal(out.length, 20);
  assert.match(out, /…$/);
});
