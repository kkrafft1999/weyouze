/**
 * Chat-Verlauf-Persistenz.
 *
 * @typedef {Object} ChatHistoryStorePort
 * @property {number} MAX_CHAT_SESSIONS
 * @property {(options?: { skipMigration?: boolean }) => Promise<object>} readChatHistoryStore
 * @property {(store: object) => Promise<void>} writeChatHistoryStore
 * @property {(fn: () => Promise<unknown>) => Promise<unknown>} withChatHistoryLock
 * @property {(sessionRow: object, options?: object) => object|null} normalizeSessionForStore
 * @property {(sessionRow: object) => object|null} normalizeSessionForLoad
 * @property {(raw: unknown) => string|null} normalizeWorkspaceRoot
 * @property {(workspaceRoot: string|null) => string} workspaceBucketKey
 * @property {(sessionRow: object, workspaceRoot: string|null) => boolean} sessionMatchesWorkspace
 */

module.exports = {};
