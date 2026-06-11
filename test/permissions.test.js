const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPermissionRequestHandler,
  isTrustedRendererUrl,
  RENDERER_URL,
} = require('../src/main/permissions');

function decide(permission, { requestingUrl, webContentsUrl } = {}) {
  const handler = createPermissionRequestHandler();
  let result = null;
  const webContents = webContentsUrl !== undefined ? { getURL: () => webContentsUrl } : null;
  const details = requestingUrl !== undefined ? { requestingUrl } : undefined;
  handler(webContents, permission, (granted) => {
    result = granted;
  }, details);
  return result;
}

test('isTrustedRendererUrl accepts the renderer URL with hash and query', () => {
  assert.equal(isTrustedRendererUrl(RENDERER_URL), true);
  assert.equal(isTrustedRendererUrl(`${RENDERER_URL}#chat`), true);
  assert.equal(isTrustedRendererUrl(`${RENDERER_URL}?debug=1`), true);
});

test('isTrustedRendererUrl rejects foreign and malformed URLs', () => {
  assert.equal(isTrustedRendererUrl('https://example.com/'), false);
  assert.equal(isTrustedRendererUrl('file:///tmp/evil.html'), false);
  assert.equal(isTrustedRendererUrl(`${RENDERER_URL}.evil.html`), false);
  assert.equal(isTrustedRendererUrl(''), false);
  assert.equal(isTrustedRendererUrl(null), false);
});

test('grants media permissions to the trusted renderer', () => {
  assert.equal(decide('media', { requestingUrl: RENDERER_URL }), true);
  assert.equal(decide('audioCapture', { requestingUrl: RENDERER_URL }), true);
});

test('denies other permissions even for the trusted renderer', () => {
  assert.equal(decide('geolocation', { requestingUrl: RENDERER_URL }), false);
  assert.equal(decide('notifications', { requestingUrl: RENDERER_URL }), false);
});

test('denies media permissions for foreign requesting URLs (e.g. external iframe)', () => {
  assert.equal(decide('media', { requestingUrl: 'https://example.com/' }), false);
  assert.equal(decide('audioCapture', { requestingUrl: 'file:///tmp/evil.html' }), false);
});

test('falls back to webContents.getURL() when details are missing', () => {
  assert.equal(decide('media', { webContentsUrl: RENDERER_URL }), true);
  assert.equal(decide('media', { webContentsUrl: 'https://example.com/' }), false);
});

test('denies when no URL can be determined', () => {
  assert.equal(decide('media', {}), false);
});
