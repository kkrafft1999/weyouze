const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isAbortError,
  sleepAbortable,
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
