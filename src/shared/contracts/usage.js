/**
 * Token-Usage-Contract (Roadmap-Etappe 1).
 *
 * Einzige Quelle der Wahrheit für die Normalisierung und Summierung der
 * provider-spezifischen Usage-Zahlen. Vorher lag diese Logik doppelt vor
 * (src/main/providers/stream-helpers.js und die Renderer-Anzeige in
 * ChatStream.js); beide beziehen sie jetzt von hier.
 */
'use strict';

function toUsageNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

function createEmptyUsage() {
  return { prompt: 0, completion: 0, total: 0 };
}

/**
 * Normalisiert eine provider-spezifische Usage-Struktur auf
 * { prompt, completion, total }. Liefert null, wenn keine Zahlen vorhanden
 * sind (so kann der Aufrufer "keine Usage" von "0 Tokens" unterscheiden).
 */
function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const prompt = toUsageNumber(
    raw.prompt
    ?? raw.input
    ?? raw.input_tokens
    ?? raw.prompt_tokens
    ?? raw.promptTokenCount
    ?? raw.prompt_eval_count
  );
  const completion = toUsageNumber(
    raw.completion
    ?? raw.output
    ?? raw.output_tokens
    ?? raw.completion_tokens
    ?? raw.candidatesTokenCount
    ?? raw.eval_count
  );
  let total = toUsageNumber(raw.total ?? raw.total_tokens ?? raw.totalTokenCount);
  if (total === 0 && (prompt > 0 || completion > 0)) {
    total = prompt + completion;
  }
  if (prompt === 0 && completion === 0 && total === 0) return null;
  return { prompt, completion, total };
}

/**
 * Wie normalizeUsage, liefert aber immer ein Objekt ({0,0,0} statt null) —
 * praktisch für die Anzeige, die keinen Nullwert darstellen muss.
 */
function coerceUsage(raw) {
  return normalizeUsage(raw) || createEmptyUsage();
}

/** Summiert zwei Usage-Objekte runden-übergreifend. */
function mergeUsage(base, addition) {
  const next = normalizeUsage(addition);
  if (!next) return base ? { ...base } : null;
  if (!base) return next;
  const prompt = base.prompt + next.prompt;
  const completion = base.completion + next.completion;
  const total = base.total + (next.total > 0 ? next.total : next.prompt + next.completion);
  return { prompt, completion, total };
}

module.exports = {
  toUsageNumber,
  createEmptyUsage,
  normalizeUsage,
  coerceUsage,
  mergeUsage,
};
