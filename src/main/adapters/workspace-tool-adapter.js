'use strict';

function createWorkspaceToolAdapter(toolRegistry) {
  return {
    getTools(options) {
      return toolRegistry.getTools(options);
    },
    buildSystemPrompt(options) {
      return toolRegistry.buildSystemPrompt(options);
    },
    execute(name, args, context) {
      return toolRegistry.execute(name, args, context);
    },
  };
}

module.exports = {
  createWorkspaceToolAdapter,
};
