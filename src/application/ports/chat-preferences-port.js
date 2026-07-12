/**
 * ChatPreferences-Port: schmale UI-Prefs-Schnittstelle für den Chat-Core.
 */

/**
 * @typedef {Object} ChatPreferences
 * @property {string} baseSystemPrompt
 * @property {boolean} allowWorkspaceWrite
 * @property {number} [maxToolRounds]
 * @property {number} [historyCharLimit]
 */

/**
 * @typedef {Object} ChatPreferencesPort
 * @property {() => Promise<ChatPreferences>} read
 */

module.exports = {};
