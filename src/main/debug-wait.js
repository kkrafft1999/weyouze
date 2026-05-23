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

function formatPauseSecondsParts(ms) {
  const seconds = ms / 1000;
  const label = Number.isInteger(seconds)
    ? String(seconds)
    : seconds.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const unit = seconds === 1 ? 'Sekunde' : 'Sekunden';
  return { label, unit };
}

function formatPauseDurationLabel(ms, phase = 'start') {
  const { label, unit } = formatPauseSecondsParts(ms);
  if (phase === 'done') return `${label} ${unit} gewartet`;
  return `Warte ${label} ${unit} …`;
}

module.exports = {
  resolveDebugWaitMs,
  formatPauseDurationLabel,
};
