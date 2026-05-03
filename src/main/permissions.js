const { session } = require('electron');

/**
 * Allows microphone capture for voice input (Whisper) in the renderer.
 * Denies other permission prompts explicitly (default Electron behavior is prompt/deny depending on OS).
 */
function registerMediaCapturePermissions(browserSession = session.defaultSession) {
  browserSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'audioCapture') {
      callback(true);
      return;
    }
    callback(false);
  });
}

module.exports = {
  registerMediaCapturePermissions,
};
