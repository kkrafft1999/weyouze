/**
 * debug_wait-Contract (Roadmap-Etappe 1).
 *
 * Einzige Quelle der Wahrheit für die Clamp-Logik der (nur zu UI-Tests
 * genutzten) Wartezeit. Die Anzeige-Zeilen nutzen dieselbe Logik über
 * src/shared/presentation/tool-display.js.
 */
'use strict';

const DEBUG_WAIT = Object.freeze({
  MIN_MS: 500,
  MAX_MS: 20000,
  DEFAULT_MS: 5000,
});

function resolveDebugWaitMs(args) {
  let ms;
  if (Number.isFinite(args?.duration_seconds)) {
    ms = Math.round(args.duration_seconds * 1000);
  } else if (Number.isFinite(args?.duration_ms)) {
    ms = Math.round(args.duration_ms);
  } else {
    ms = DEBUG_WAIT.DEFAULT_MS;
  }
  return Math.min(DEBUG_WAIT.MAX_MS, Math.max(DEBUG_WAIT.MIN_MS, ms));
}

module.exports = {
  DEBUG_WAIT,
  resolveDebugWaitMs,
};
