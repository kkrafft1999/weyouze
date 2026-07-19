'use strict';

function createChatPreferencesAdapter({ uiPrefsStore }) {
  return {
    async read() {
      const prefs = await uiPrefsStore.readUIPrefs();
      const out = {
        baseSystemPrompt: typeof prefs.baseSystemPrompt === 'string' ? prefs.baseSystemPrompt : '',
        allowWorkspaceWrite: prefs.allowWorkspaceWrite === true,
        disabledTools: Array.isArray(prefs.disabledTools)
          ? prefs.disabledTools.filter((name) => typeof name === 'string' && name.trim())
          : [],
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
