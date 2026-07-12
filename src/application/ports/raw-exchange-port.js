/**
 * RawExchange-Port: RAW-LLM-Protokoll-Aufzeichnung ohne llm-raw-log im Core.
 */

/**
 * @typedef {Object} RoundRecorder
 * @property {(req: { url?: string, method?: string, headers?: object, body?: unknown }) => void} request
 * @property {(line: string) => void} onRawLine
 * @property {(meta: object) => object} toExchange
 */

/**
 * @typedef {Object} RawExchangePort
 * @property {() => RoundRecorder} createRoundRecorder
 */

module.exports = {};
