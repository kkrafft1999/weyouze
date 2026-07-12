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
 * @typedef {Object} ToolPort
 * @property {(options?: { allowWrite?: boolean }) => Array} getTools
 * @property {(options?: { allowWrite?: boolean }) => string} buildSystemPrompt
 * @property {(name: string, args: object, ctx: ToolExecutionContext) => Promise<string>} execute
 */

module.exports = {};
