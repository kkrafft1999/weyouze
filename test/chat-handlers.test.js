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

test('summarizeToolCall formats workspace tools', () => {
  assert.equal(summarizeToolCall('list_directory', { relative_path: 'src/main' }), 'list_directory(src/main)');
  assert.equal(summarizeToolCall('read_file_text', { relative_path: 'README.md' }), 'read_file_text(README.md)');
});

test('truncateToolLabel shortens long labels', () => {
  const long = 'a'.repeat(60);
  const out = truncateToolLabel(long, 20);
  assert.equal(out.length, 20);
  assert.match(out, /…$/);
});
