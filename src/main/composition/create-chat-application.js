'use strict';

const { createChatEngine } = require('../../application/chat/chat-engine');
const { createProviderLlmAdapter } = require('../adapters/provider-llm-adapter');
const { createChatPreferencesAdapter } = require('../adapters/chat-preferences-adapter');
const { createNodeWorkspacePathAdapter } = require('../adapters/workspace-path-adapter');
const { createRawExchangeAdapter } = require('../adapters/raw-exchange-adapter');
const { createWorkspaceToolAdapter } = require('../adapters/workspace-tool-adapter');

function createChatApplication({
  storage,
  providers,
  toolRegistry,
  path,
  maxToolRounds,
}) {
  const llm = createProviderLlmAdapter({ providers, storage });
  const tools = createWorkspaceToolAdapter(toolRegistry);
  const preferences = createChatPreferencesAdapter({ storage });
  const workspacePaths = createNodeWorkspacePathAdapter({ path });
  const rawExchange = createRawExchangeAdapter();

  const engine = createChatEngine({
    llm,
    tools,
    preferences,
    workspacePaths,
    rawExchange,
    maxToolRounds,
  });

  return { engine, llm, tools, preferences, workspacePaths, rawExchange };
}

module.exports = {
  createChatApplication,
};
