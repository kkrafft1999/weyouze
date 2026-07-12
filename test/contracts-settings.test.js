const test = require('node:test');
const assert = require('node:assert/strict');
const contracts = require('../src/shared/contracts');
const {
  normalizePresetWire,
  presetIdentityKey,
  normalizeUiPrefs,
  normalizeUiPrefsPatch,
  clampMaxToolRounds,
  clampSidebarWidth,
  formatConnectionDetail,
  formatPresetSublabelFromView,
  createListModelsResult,
  createSettingsOk,
  createSettingsError,
} = contracts;
const openai = require('../src/main/providers/openai');
const ollama = require('../src/main/providers/ollama');

test('settings contract helpers are exported from the aggregate', () => {
  assert.equal(typeof normalizePresetWire, 'function');
  assert.equal(typeof presetIdentityKey, 'function');
  assert.equal(typeof formatConnectionDetail, 'function');
});

test('normalizePresetWire accepts legacy reasoningEffort for OpenAI', () => {
  const preset = normalizePresetWire(
    { id: 'p1', providerId: 'openai', model: 'gpt-4o', reasoningEffort: 'high' },
    (id) => (id === 'openai' ? openai : null)
  );
  assert.deepEqual(preset, {
    id: 'p1',
    providerId: 'openai',
    model: 'gpt-4o',
    menuVisible: true,
    reasoningEffort: 'high',
  });
});

test('normalizePresetWire strips reasoningEffort for providers without preset fields', () => {
  const preset = normalizePresetWire(
    { id: 'p1', providerId: 'anthropic', model: 'claude', reasoningEffort: 'high' },
    (id) => (id === 'anthropic' ? { defaultModel: 'claude', presentation: {} } : null)
  );
  assert.deepEqual(preset, {
    id: 'p1',
    providerId: 'anthropic',
    model: 'claude',
    menuVisible: true,
  });
});

test('presetIdentityKey distinguishes OpenAI presets by reasoning effort', () => {
  const providerView = { presetFields: openai.presentation.presetFields };
  const a = { providerId: 'openai', model: 'gpt-4o', reasoningEffort: 'low' };
  const b = { providerId: 'openai', model: 'gpt-4o', reasoningEffort: 'high' };
  assert.notEqual(presetIdentityKey(a, providerView), presetIdentityKey(b, providerView));
  assert.equal(
    presetIdentityKey(a, providerView),
    presetIdentityKey({ ...a }, openai)
  );
});

test('formatConnectionDetail renders host and TLS state', () => {
  const text = formatConnectionDetail(ollama, {
    baseUrl: 'https://ollama.internal:11434',
    insecureTls: true,
  });
  assert.equal(text, 'Server: ollama.internal:11434 · TLS insecure');
});

test('formatPresetSublabelFromView uses view DTO presetFields and connectionDetail', () => {
  const openaiView = {
    apiBase: 'https://api.openai.com/v1',
    presetFields: [{
      key: 'reasoningEffort',
      detailPrefix: 'reasoning_effort: ',
      detailStyle: 'mono',
    }],
  };
  const sub = formatPresetSublabelFromView(
    { providerId: 'openai', model: 'gpt-4o', reasoningEffort: 'medium' },
    openaiView
  );
  assert.equal(sub.text, 'reasoning_effort: medium');
  assert.equal(sub.style, 'mono');

  const ollamaView = {
    connectionDetail: true,
    baseUrl: 'http://127.0.0.1:11434',
    insecureTls: false,
    apiBase: 'http://localhost:11434',
    presetFields: [],
  };
  const conn = formatPresetSublabelFromView(
    { providerId: 'ollama', model: 'llama3.2' },
    ollamaView,
    { baseUrl: 'https://draft.local', insecureTls: true }
  );
  assert.match(conn.text, /draft\.local/);
  assert.match(conn.text, /TLS insecure/);
});

test('normalizeUiPrefs and patch apply clamps', () => {
  assert.equal(normalizeUiPrefs({ appLocale: 'en' }).appLocale, 'en');
  assert.equal(normalizeUiPrefs({ allowWorkspaceWrite: true }).allowWorkspaceWrite, true);
  const patch = normalizeUiPrefsPatch({ maxToolRounds: 9999, sidebarWidth: 50 });
  assert.equal(patch.maxToolRounds, 500);
  assert.equal(patch.sidebarWidth, 150);
  assert.equal(clampMaxToolRounds(0), 1);
  assert.equal(clampSidebarWidth(999), 600);
});

test('createListModelsResult and settings result DTOs', () => {
  assert.deepEqual(createSettingsOk(), { ok: true });
  assert.deepEqual(createSettingsError('x'), { ok: false, error: 'x' });
  assert.deepEqual(createListModelsResult({ models: [{ id: 'm1' }] }), {
    models: [{ id: 'm1' }],
  });
  assert.deepEqual(createListModelsResult({ error: 'fail' }), { error: 'fail' });
});
