// Formatiert Tool-Call-Ereignisse aus dem Main-Prozess zu Anzeige-Zeilen
// (Review 2026-05-23, G5): Main pusht nur Rohdaten ({ tool, args, phase,
// noWorkspace }), die Lokalisierung lebt hier im Renderer.

const DEBUG_WAIT_MIN_MS = 500;
const DEBUG_WAIT_MAX_MS = 20000;
const DEBUG_WAIT_DEFAULT_MS = 5000;

export function truncateToolLabel(s, max = 48) {
  const t = String(s ?? '');
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatRelativePathForLabel(relativePath) {
  const raw = typeof relativePath === 'string' ? relativePath.trim() : '';
  if (!raw || raw === '.') return null;
  return truncateToolLabel(raw);
}

// Muss zur Clamp-Logik in src/main/debug-wait.js passen, damit das Label die
// tatsächliche Wartezeit nennt.
function resolveDebugWaitMs(args) {
  let ms;
  if (Number.isFinite(args?.duration_seconds)) {
    ms = Math.round(args.duration_seconds * 1000);
  } else if (Number.isFinite(args?.duration_ms)) {
    ms = Math.round(args.duration_ms);
  } else {
    ms = DEBUG_WAIT_DEFAULT_MS;
  }
  return Math.min(DEBUG_WAIT_MAX_MS, Math.max(DEBUG_WAIT_MIN_MS, ms));
}

function formatPauseDurationLabel(ms, phase) {
  const seconds = ms / 1000;
  const label = Number.isInteger(seconds)
    ? String(seconds)
    : seconds.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const unit = seconds === 1 ? 'Sekunde' : 'Sekunden';
  if (phase === 'done') return `${label} ${unit} gewartet`;
  return `Warte ${label} ${unit} …`;
}

export function summarizeToolCall(toolName, args, phase = 'start') {
  const isDone = phase === 'done';
  if (toolName === 'list_directory') {
    const pathLabel = formatRelativePathForLabel(args?.relative_path);
    if (pathLabel) {
      return isDone ? `Ordner ${pathLabel} durchsucht` : `Ordner ${pathLabel} wird durchsucht …`;
    }
    return isDone ? 'Projektordner durchsucht' : 'Projektordner wird durchsucht …';
  }
  if (toolName === 'read_file_text') {
    const pathLabel = formatRelativePathForLabel(args?.relative_path);
    if (pathLabel) {
      return isDone ? `Datei ${pathLabel} gelesen` : `Datei ${pathLabel} wird gelesen …`;
    }
    return isDone ? 'Datei gelesen' : 'Datei wird gelesen …';
  }
  if (toolName === 'debug_wait') {
    return formatPauseDurationLabel(resolveDebugWaitMs(args), phase);
  }
  const name = truncateToolLabel(toolName || 'Tool');
  return isDone ? `${name} ausgeführt` : `${name} wird ausgeführt …`;
}

/**
 * Formatiert ein Tool-Ereignis aus dem Main-Prozess ({ tool, args,
 * noWorkspace }) zur Anzeige-Zeile. Bereits formatierte Strings (persistierte
 * Alt-Sessions) gehen unverändert durch.
 */
export function summarizeToolEvent(entry, phase = 'start') {
  if (typeof entry === 'string') return entry;
  const line = summarizeToolCall(entry?.tool, entry?.args, phase);
  return entry?.noWorkspace ? `${line} · kein Ordner geöffnet` : line;
}
