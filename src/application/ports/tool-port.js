/**
 * Tool-Port: Workspace-Tools ohne konkrete Registry im Core.
 */

/**
 * @typedef {Object} ToolExecutionContext
 * @property {string} workspaceRoot
 * @property {AbortSignal} abortSignal
 * @property {boolean} allowWrite
 */

/**
 * @typedef {Object} ToolTraceEntry
 * @property {string} tool
 * @property {object} args
 * @property {number} [waitMs]
 * @property {boolean} [noWorkspace]
 * @property {string} [line] — fertige Anzeige-Zeile (done-Phase), für Persistenz
 */

/**
 * @typedef {Object} ToolExecutionResult
 * @property {string} output — JSON-String für die Tool-Nachricht ans Modell
 * @property {Array<object>} [progressEvents] — fertige chat:progress-Payloads vom Adapter
 */

/**
 * @typedef {Object} ToolPort
 * @property {(options?: { allowWrite?: boolean }) => Array} getTools
 * @property {(options?: { allowWrite?: boolean }) => string} buildSystemPrompt
 * @property {(toolName: string, args: object, extra?: object) => ToolTraceEntry} buildTraceEntry
 * @property {(entry: ToolTraceEntry, phase: string, locale?: string) => string} formatDisplayLine
 * @property {(name: string, args: object, ctx: ToolExecutionContext) => Promise<ToolExecutionResult>} execute
 */

module.exports = {};
