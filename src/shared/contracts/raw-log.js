/**
 * RAW-LLM-Protokoll View-DTOs (Stage 5).
 *
 * Schlanke, serialisierbare Anzeige-Modelle. Rohdaten (messages, request,
 * responseRaw) leben nur in rawExchanges; der Renderer paart sie lokal mit
 * dem View-Modell per exchangeIndex/msgIndex.
 */
'use strict';

/** @typedef {'system'|'user'|'assistant'|'tool'|'unknown'} RawLogMessageRole */

/**
 * @typedef {Object} RawLogAnswerCallVm
 * @property {string} [callId]
 * @property {number} callIndex
 * @property {string} name
 * @property {string} nameLine
 * @property {boolean} hasArguments
 */

/**
 * @typedef {Object} RawLogRoundDetailVm
 * @property {number} roundNo
 * @property {number} exchangeIndex
 * @property {boolean} errored
 * @property {string} outcome
 * @property {string} metaText
 * @property {string} sentLabel
 * @property {boolean} sentEmpty
 * @property {string} [sentEmptyText]
 * @property {number} prevSentCount
 * @property {number[]} newMessageIndices
 * @property {boolean} showAllMessages
 * @property {number} allMessagesCount
 * @property {string} [errorText]
 * @property {{ hasText: boolean, toolCalls: RawLogAnswerCallVm[] }} answer
 * @property {string} [finishWarn]
 * @property {boolean} cancelled
 * @property {string} [requestParamsLine]
 * @property {boolean} hasRawSection
 */

/**
 * @typedef {Object} RawLogStackToolLayerVm
 * @property {number} count
 * @property {string} namesSnippet
 * @property {string} schemasPretty
 * @property {string} title
 * @property {string} ariaLabel
 */

/**
 * @typedef {Object} RawLogStackLayerVm
 * @property {number} exchangeIndex
 * @property {number} msgIndex
 * @property {string} roleLabel
 * @property {string} cssCls
 * @property {boolean} isNew
 * @property {boolean} resent
 * @property {string} snippet
 * @property {string} title
 * @property {string} ariaLabel
 * @property {string} [callLabel]
 * @property {boolean} showNewBadge
 * @property {string} newBadgeSuffix
 */

/**
 * @typedef {Object} RawLogStackBarVm
 * @property {number} widthPct
 * @property {string} label
 * @property {string} title
 */

/**
 * @typedef {Object} RawLogResponseCardVm
 * @property {string} outLabel
 * @property {'error'|'json'|'text'|'empty'} kind
 * @property {string[]} [jsonCalls]
 * @property {string} [textSnippet]
 * @property {string} [errorText]
 */

/**
 * @typedef {Object} RawLogExecStripVm
 * @property {string} summaryCall
 * @property {string} bodyCall
 * @property {string} resultLabel
 * @property {boolean} resultRecorded
 * @property {string} resultText
 * @property {string} noteText
 */

/**
 * @typedef {Object} RawLogContextRoundVm
 * @property {number} roundNo
 * @property {number} exchangeIndex
 * @property {boolean} errored
 * @property {string} sentInfo
 * @property {RawLogStackToolLayerVm} [toolLayer]
 * @property {RawLogStackLayerVm[]} layers
 * @property {RawLogStackBarVm} bar
 * @property {RawLogResponseCardVm} responseCard
 * @property {RawLogExecStripVm[]} execStrips
 */

/**
 * @typedef {Object} RawLogContextStackVm
 * @property {string} metaStat
 * @property {string} footText
 * @property {RawLogContextRoundVm[]} rounds
 */

/**
 * @typedef {Object} RawLogTurnVm
 * @property {number} [index]
 * @property {string} userText
 * @property {string} summaryText
 * @property {number} ts
 * @property {number} exchangeCount
 * @property {string} roundsSummary
 * @property {RawLogContextStackVm} contextStack
 * @property {RawLogRoundDetailVm[]} rounds
 */

/**
 * Renderer-lokaler Eintrag: View-Modell + genau eine Kopie der Rohdaten.
 * @typedef {RawLogTurnVm & { exchanges?: unknown[], incomplete?: boolean }} RawLogTurnEntry
 */

/**
 * Ergänzt ein Chat-Ergebnis additiv um rawLogTurn (rawExchanges bleibt separat).
 */
function attachRawLogTurn(result, rawLogTurn) {
  if (!result || !rawLogTurn) return result;
  return { ...result, rawLogTurn };
}

module.exports = {
  attachRawLogTurn,
};
