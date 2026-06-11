const path = require('path');
const { pathToFileURL } = require('url');

const RENDERER_URL = pathToFileURL(path.resolve(__dirname, '..', 'renderer', 'index.html')).href;

/**
 * Defense-in-depth: CSP and will-navigate already keep foreign origins out of the
 * window, but permission grants are additionally restricted to our own file://
 * renderer so an embedded frame or unexpected navigation never gets mic access.
 */
function isTrustedRendererUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl === '') {
    return false;
  }
  return (
    rawUrl === RENDERER_URL ||
    rawUrl.startsWith(`${RENDERER_URL}#`) ||
    rawUrl.startsWith(`${RENDERER_URL}?`)
  );
}

function createPermissionRequestHandler() {
  return (webContents, permission, callback, details) => {
    const requestingUrl =
      (details && details.requestingUrl) || (webContents && webContents.getURL()) || '';
    if (!isTrustedRendererUrl(requestingUrl)) {
      callback(false);
      return;
    }
    if (permission === 'media' || permission === 'audioCapture') {
      callback(true);
      return;
    }
    callback(false);
  };
}

/**
 * Allows microphone capture for voice input (Whisper) in the renderer.
 * Denies other permission prompts explicitly (default Electron behavior is prompt/deny depending on OS).
 */
function registerMediaCapturePermissions(browserSession) {
  const targetSession = browserSession || require('electron').session.defaultSession;
  targetSession.setPermissionRequestHandler(createPermissionRequestHandler());
}

module.exports = {
  registerMediaCapturePermissions,
  createPermissionRequestHandler,
  isTrustedRendererUrl,
  RENDERER_URL,
};
