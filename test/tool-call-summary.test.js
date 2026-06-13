const test = require('node:test');
const assert = require('node:assert/strict');

// Das Modul ist ESM (Renderer) — in der CJS-Test-Suite per dynamic import laden.
const summaryModule = import('../src/renderer/chat/toolCallSummary.js');

test('summarizeToolCall formats workspace tools with start and done labels', async () => {
  const { summarizeToolCall } = await summaryModule;
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

test('truncateToolLabel shortens long labels', async () => {
  const { truncateToolLabel } = await summaryModule;
  const long = 'a'.repeat(60);
  const out = truncateToolLabel(long, 20);
  assert.equal(out.length, 20);
  assert.match(out, /…$/);
});

test('summarizeToolEvent formats raw main-process entries', async () => {
  const { summarizeToolEvent } = await summaryModule;
  assert.equal(
    summarizeToolEvent({ tool: 'read_file_text', args: { relative_path: 'a.js' } }, 'done'),
    'Datei a.js gelesen'
  );
  assert.equal(
    summarizeToolEvent({ tool: 'list_directory', args: {}, noWorkspace: true }, 'start'),
    'Projektordner wird durchsucht … · kein Ordner geöffnet'
  );
  // Persistierte Alt-Sessions enthalten bereits formatierte Strings.
  assert.equal(summarizeToolEvent('Datei x gelesen', 'done'), 'Datei x gelesen');
});

test('summarizeToolEvent uses main-supplied waitMs for debug_wait', async () => {
  const { summarizeToolEvent } = await summaryModule;
  // Der Main reicht die bereits geclampte Wartezeit mit; sie hat Vorrang vor
  // einer Rekonstruktion aus den Rohargs.
  assert.equal(
    summarizeToolEvent({ tool: 'debug_wait', args: {}, waitMs: 1200 }, 'start'),
    'Warte 1,2 Sekunden …'
  );
  assert.equal(
    summarizeToolEvent({ tool: 'debug_wait', args: {}, waitMs: 1000 }, 'done'),
    '1 Sekunde gewartet'
  );
});
