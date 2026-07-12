/**
 * Chat-DTO- und Event-Contract (Roadmap-Etappe 1).
 *
 * Factories für die Ergebnis-Objekte von CHAT_SEND und für die Push-Events
 * (chat:delta, chat:tool-line, chat:progress). Sie erzeugen exakt die Formen,
 * die bisher inline in src/main/ipc/chat-handlers.js gebaut wurden — so bleibt
 * das Wire-Format stabil, während Erzeugung und Validierung zentral liegen.
 */
'use strict';

const {
  CHAT_ERROR_CODES,
  CHAT_PHASES,
  TOOL_LINE_PHASES,
  CHAT_PROGRESS_TYPES,
} = require('./enums');

// --- Ergebnis-DTOs (Rückgabe von CHAT_SEND) --------------------------------

/** Erfolgreiches Chat-Ergebnis (Modell hat geantwortet, keine Tools mehr offen). */
function createChatResult({ content = '', toolTrace = [], usage = null, rawExchanges = [] } = {}) {
  return { content, toolTrace, usage, rawExchanges };
}

/** Vom Nutzer bzw. per AbortSignal abgebrochenes Chat-Ergebnis. */
function createCancelledChatResult({ content = '', toolTrace = [], usage = null, rawExchanges = [] } = {}) {
  return { cancelled: true, content, toolTrace, usage, rawExchanges };
}

/**
 * Fehler-Ergebnis. usage/rawExchanges werden nur aufgenommen, wenn sie
 * übergeben wurden — Frühabbrüche (z. B. leere Nachricht) bleiben so bei der
 * schlanken Form { error, code }, wie sie der Renderer erwartet.
 */
function createChatErrorResult({ error, code = CHAT_ERROR_CODES.INVALID, usage, rawExchanges } = {}) {
  const result = { error, code };
  if (usage !== undefined) result.usage = usage;
  if (rawExchanges !== undefined) result.rawExchanges = rawExchanges;
  return result;
}

// --- Push-Events (Main -> Renderer) ----------------------------------------

/** chat:delta — ein Stück Antwort-Text. */
function createDeltaEvent(text) {
  return { text: String(text ?? '') };
}

/**
 * chat:tool-line — Rohdaten eines Tool-Ereignisses; die Lokalisierung baut der
 * Renderer. entry = { tool, args, waitMs?, noWorkspace? }.
 */
function createToolLineEvent(phase, entry) {
  return { phase, ...entry };
}

/** chat:progress mit type='phase'. */
function createPhaseEvent(phase) {
  return { type: CHAT_PROGRESS_TYPES.PHASE, phase };
}

/** chat:progress mit type='reasoning'. */
function createReasoningEvent(text) {
  return { type: CHAT_PROGRESS_TYPES.REASONING, text };
}

// --- Validatoren ------------------------------------------------------------

function isChatErrorCode(code) {
  return Object.values(CHAT_ERROR_CODES).includes(code);
}

function isChatPhase(phase) {
  return Object.values(CHAT_PHASES).includes(phase);
}

function isToolLinePhase(phase) {
  return Object.values(TOOL_LINE_PHASES).includes(phase);
}

module.exports = {
  createChatResult,
  createCancelledChatResult,
  createChatErrorResult,
  createDeltaEvent,
  createToolLineEvent,
  createPhaseEvent,
  createReasoningEvent,
  isChatErrorCode,
  isChatPhase,
  isToolLinePhase,
};
