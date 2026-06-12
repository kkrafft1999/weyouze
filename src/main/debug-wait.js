const MIN_MS = 500;
const MAX_MS = 20000;
const DEFAULT_MS = 5000;

function resolveDebugWaitMs(args) {
  let ms;
  if (Number.isFinite(args?.duration_seconds)) {
    ms = Math.round(args.duration_seconds * 1000);
  } else if (Number.isFinite(args?.duration_ms)) {
    ms = Math.round(args.duration_ms);
  } else {
    ms = DEFAULT_MS;
  }
  return Math.min(MAX_MS, Math.max(MIN_MS, ms));
}

// Das deutsche Anzeige-Label zur Wartezeit baut der Renderer
// (src/renderer/chat/toolCallSummary.js) — hier lebt nur die Clamp-Logik.
module.exports = {
  resolveDebugWaitMs,
};
