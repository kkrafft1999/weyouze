/**
 * Aggregat der Contract-Schicht (Roadmap-Etappe 1).
 *
 * Versionierte, frontend-unabhängige Verträge (DTOs, Events, Enums,
 * Validatoren) für Chat, Streaming, Tools und Token-Usage. Single Source of
 * Truth für Main (require) und Renderer (generiertes ESM-Bundle).
 *
 * Das module.exports ist bewusst ein flaches Objekt-Literal, damit esbuild
 * beim CJS→ESM-Bundling für den Renderer benannte Exporte ableiten kann.
 */
'use strict';

const { CONTRACT_VERSION, CHAT_ERROR_CODES, CHAT_PHASES, TOOL_LINE_PHASES, CHAT_PROGRESS_TYPES } = require('./enums');
const { toUsageNumber, createEmptyUsage, normalizeUsage, coerceUsage, mergeUsage } = require('./usage');
const { DEBUG_WAIT, resolveDebugWaitMs } = require('./debug-wait');
const {
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
} = require('./chat');

module.exports = {
  CONTRACT_VERSION,
  CHAT_ERROR_CODES,
  CHAT_PHASES,
  TOOL_LINE_PHASES,
  CHAT_PROGRESS_TYPES,
  toUsageNumber,
  createEmptyUsage,
  normalizeUsage,
  coerceUsage,
  mergeUsage,
  DEBUG_WAIT,
  resolveDebugWaitMs,
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
