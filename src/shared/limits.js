// Zentrale App-Limits (Review 2026-05-23, G3). MAX_TOOL_ROUNDS ist nur der
// Default — der effektive Wert ist über Einstellungen › Allgemein
// (ui-preferences.json, maxToolRounds) überschreibbar.
const LIMITS = Object.freeze({
  MAX_CHAT_SESSIONS: 200,
  MAX_FOLDER_HISTORY: 10,
  MAX_TOOL_ROUNDS: 14,
  MAX_READ_FILE_BYTES: 2 * 1024 * 1024,
});

module.exports = { LIMITS };
