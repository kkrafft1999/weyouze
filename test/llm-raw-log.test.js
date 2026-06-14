const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createRoundRecorder,
  redactHeaders,
  redactUrl,
  redactSecrets,
  serializeBody,
} = require('../src/main/llm-raw-log');

test('redactHeaders masks secret header values, keeps the rest', () => {
  const out = redactHeaders({
    'x-api-key': 'sk-ant-secret',
    Authorization: 'Bearer sk-secret',
    'content-type': 'application/json',
  });
  assert.equal(out['x-api-key'], '***redigiert***');
  assert.equal(out.Authorization, '***redigiert***');
  assert.equal(out['content-type'], 'application/json');
});

test('redactUrl masks the key query param (Google) but keeps the path', () => {
  const out = redactUrl(
    'https://generativelanguage.googleapis.com/v1/models/gemini:streamGenerateContent?alt=sse&key=AIzaSECRET'
  );
  assert.match(out, /alt=sse/);
  assert.match(out, /key=%2A%2A%2Aredigiert%2A%2A%2A|key=\*\*\*redigiert\*\*\*/);
  assert.doesNotMatch(out, /AIzaSECRET/);
});

test('serializeBody pretty-prints JSON and masks secret-ish fields', () => {
  const text = serializeBody({ model: 'x', apiKey: 'sk-leak', messages: [{ role: 'user' }] });
  assert.match(text, /"model": "x"/);
  assert.match(text, /"apiKey": "\*\*\*redigiert\*\*\*"/);
  assert.doesNotMatch(text, /sk-leak/);
});

test('serializeBody passes raw strings through unchanged', () => {
  assert.equal(serializeBody('already-a-string'), 'already-a-string');
  assert.equal(serializeBody(null), '');
});

test('redactSecrets masks known key formats in free-text, keeps the rest', () => {
  assert.equal(redactSecrets('oops sk-ant-api03-LEAKED here'), 'oops ***redigiert*** here');
  assert.equal(redactSecrets('token sk-LEAKEDLEAKEDLEAKED end'), 'token ***redigiert*** end');
  assert.equal(redactSecrets('key AIzaLEAKEDLEAKEDLEAKED end'), 'key ***redigiert*** end');
  assert.equal(redactSecrets('Authorization: Bearer abcdef0123456789'), 'Authorization: Bearer ***redigiert***');
  assert.equal(redactSecrets('just normal text, no secrets'), 'just normal text, no secrets');
});

test('round recorder redacts secrets echoed back in the response stream', () => {
  const rec = createRoundRecorder();
  rec.onRawLine('data: {"error":"invalid key sk-ant-api03-SECRETSECRETSECRET"}');
  const ex = rec.toExchange({});
  assert.doesNotMatch(ex.responseRaw, /SECRETSECRETSECRET/);
  assert.match(ex.responseRaw, /\*\*\*redigiert\*\*\*/);
});

test('round recorder captures request and accumulates raw response lines', () => {
  const rec = createRoundRecorder();
  rec.request({
    url: 'https://api.anthropic.com/v1/messages',
    method: 'POST',
    headers: { 'x-api-key': 'sk-secret', 'content-type': 'application/json' },
    body: { model: 'claude', stream: true },
  });
  rec.onRawLine('event: message_start');
  rec.onRawLine('data: {"type":"message_start"}');

  const ex = rec.toExchange({ providerId: 'anthropic', model: 'claude', round: 0, ts: 123 });
  assert.equal(ex.providerId, 'anthropic');
  assert.equal(ex.model, 'claude');
  assert.equal(ex.round, 0);
  assert.equal(ex.ts, 123);
  assert.equal(ex.request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(ex.request.headers['x-api-key'], '***redigiert***');
  assert.match(ex.request.body, /"model": "claude"/);
  assert.equal(ex.responseRaw, 'event: message_start\ndata: {"type":"message_start"}');
});

test('round recorder truncates an over-long response stream', () => {
  const rec = createRoundRecorder();
  const big = 'x'.repeat(1_500_000);
  rec.onRawLine(big);
  rec.onRawLine(big); // pushes past the 2M cap
  const ex = rec.toExchange({});
  assert.ok(ex.responseRaw.length <= 2_100_000);
  assert.match(ex.responseRaw, /gekuerzt/);
});
