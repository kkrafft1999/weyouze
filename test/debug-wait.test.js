const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDebugWaitMs } = require('../src/main/debug-wait');

test('resolveDebugWaitMs defaults to 5000ms without args', () => {
  assert.equal(resolveDebugWaitMs(), 5000);
  assert.equal(resolveDebugWaitMs({}), 5000);
});

test('resolveDebugWaitMs prefers duration_seconds over duration_ms', () => {
  assert.equal(resolveDebugWaitMs({ duration_seconds: 2, duration_ms: 9999 }), 2000);
});

test('resolveDebugWaitMs falls back to duration_ms when duration_seconds is missing', () => {
  assert.equal(resolveDebugWaitMs({ duration_ms: 1234 }), 1234);
});

test('resolveDebugWaitMs rounds fractional milliseconds', () => {
  assert.equal(resolveDebugWaitMs({ duration_seconds: 1.2345 }), 1235);
  assert.equal(resolveDebugWaitMs({ duration_ms: 999.6 }), 1000);
});

test('resolveDebugWaitMs clamps to the minimum of 500ms', () => {
  assert.equal(resolveDebugWaitMs({ duration_seconds: 0 }), 500);
  assert.equal(resolveDebugWaitMs({ duration_ms: -50 }), 500);
});

test('resolveDebugWaitMs clamps to the maximum of 20000ms', () => {
  assert.equal(resolveDebugWaitMs({ duration_seconds: 999 }), 20000);
  assert.equal(resolveDebugWaitMs({ duration_ms: 50000 }), 20000);
});

test('resolveDebugWaitMs ignores non-finite values', () => {
  assert.equal(resolveDebugWaitMs({ duration_seconds: NaN, duration_ms: Infinity }), 5000);
  assert.equal(resolveDebugWaitMs({ duration_seconds: 'x' }), 5000);
});
