'use strict';

function createChatPreferencesAdapter({ storage }) {
  return {
    async read() {
      const prefs = await storage.readUIPrefs();
      const out = {
        baseSystemPrompt: typeof prefs.baseSystemPrompt === 'string' ? prefs.baseSystemPrompt : '',
        allowWorkspaceWrite: prefs.allowWorkspaceWrite === true,
      };
      if (typeof prefs.maxToolRounds === 'number' && Number.isFinite(prefs.maxToolRounds)) {
        out.maxToolRounds = prefs.maxToolRounds;
      }
      if (typeof prefs.historyCharLimit === 'number' && Number.isFinite(prefs.historyCharLimit)) {
        out.historyCharLimit = prefs.historyCharLimit;
      }
      return out;
    },
  };
}

module.exports = {
  createChatPreferencesAdapter,
};
