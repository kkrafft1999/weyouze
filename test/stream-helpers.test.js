const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAbortError,
  sleepAbortable,
  normalizeUsage,
  mergeUsage,
} = require('../src/main/providers/stream-helpers');

test('isAbortError recognizes AbortError', () => {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  assert.equal(isAbortError(err), true);
  assert.equal(isAbortError(new Error('other')), false);
});

test('sleepAbortable rejects when signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => sleepAbortable(50, controller.signal), (err) => isAbortError(err));
});

test('sleepAbortable rejects when aborted during wait', async () => {
  const controller = new AbortController();
  const pending = sleepAbortable(500, controller.signal);
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(() => pending, (err) => isAbortError(err));
});

test('normalizeUsage maps provider-specific usage fields', () => {
  assert.deepEqual(normalizeUsage({ input_tokens: 10, output_tokens: 5 }), {
    prompt: 10,
    completion: 5,
    total: 15,
  });
  assert.deepEqual(normalizeUsage({ promptTokenCount: 8, candidatesTokenCount: 3 }), {
    prompt: 8,
    completion: 3,
    total: 11,
  });
  assert.equal(normalizeUsage({}), null);
});

test('mergeUsage sums usage across rounds', () => {
  assert.deepEqual(
    mergeUsage(
      { prompt: 10, completion: 5, total: 15 },
      { prompt: 3, completion: 2, total: 5 }
    ),
    { prompt: 13, completion: 7, total: 20 }
  );
});
