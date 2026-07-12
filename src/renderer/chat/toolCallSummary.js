// Formatiert Tool-Call-Ereignisse aus dem Main-Prozess zu Anzeige-Zeilen
// (Review 2026-05-23, G5): Main pusht nur Rohdaten ({ tool, args, phase,
// noWorkspace }), die Lokalisierung lebt hier im Renderer.
//
// Die Clamp-Logik der debug_wait-Wartezeit kommt aus der gemeinsamen
// Contract-Schicht (Single Source of Truth), damit sie nicht vom Main
// abweichen kann. contracts ist der Default-Export des generierten ESM-Bundles.
import contracts from '../generated/contracts.js';

const { resolveDebugWaitMs } = contracts;

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
  if (toolName === 'write_file_text') {
    const pathLabel = formatRelativePathForLabel(args?.relative_path);
    if (pathLabel) {
      return isDone ? `Datei ${pathLabel} geschrieben` : `Datei ${pathLabel} wird geschrieben …`;
    }
    return isDone ? 'Datei geschrieben' : 'Datei wird geschrieben …';
  }
  if (toolName === 'debug_wait') {
    return formatPauseDurationLabel(resolveDebugWaitMs(args), phase);
  }
  const name = truncateToolLabel(toolName || 'Tool');
  return isDone ? `${name} ausgeführt` : `${name} wird ausgeführt …`;
}

/**
 * Formatiert ein Tool-Ereignis aus dem Main-Prozess ({ tool, args,
 * noWorkspace, waitMs }) zur Anzeige-Zeile. Bereits formatierte Strings
 * (persistierte Alt-Sessions) gehen unverändert durch.
 */
export function summarizeToolEvent(entry, phase = 'start') {
  if (typeof entry === 'string') return entry;
  // Für debug_wait das vom Main mitgelieferte, bereits geclampte waitMs nutzen,
  // statt es im Renderer erneut aus den Rohargs abzuleiten.
  const line =
    entry?.tool === 'debug_wait' && Number.isFinite(entry?.waitMs)
      ? formatPauseDurationLabel(entry.waitMs, phase)
      : summarizeToolCall(entry?.tool, entry?.args, phase);
  return entry?.noWorkspace ? `${line} · kein Ordner geöffnet` : line;
}
