'use strict';

const { resolveDebugWaitMs } = require('../../shared/contracts/debug-wait');
const { createWorkspaceFileWrittenEvent } = require('../../shared/contracts/chat');
const { formatToolDisplayLine } = require('../../shared/presentation/tool-display');

function createWorkspaceToolAdapter(toolRegistry) {
  return {
    getTools(options) {
      return toolRegistry.getTools(options);
    },
    buildSystemPrompt(options) {
      return toolRegistry.buildSystemPrompt(options);
    },
    buildTraceEntry(toolName, args, extra = {}) {
      const entry = { tool: toolName, args, ...extra };
      if (toolName === 'debug_wait') {
        entry.waitMs = resolveDebugWaitMs(args);
      }
      return entry;
    },
    formatDisplayLine(entry, phase, locale) {
      return formatToolDisplayLine(entry, phase, locale);
    },
    async execute(name, args, context) {
      const output = await toolRegistry.execute(name, args, context);
      const progressEvents = collectProgressEvents(name, args, output);
      return { output, progressEvents };
    },
  };
}

function collectProgressEvents(toolName, args, output) {
  const events = [];
  if (toolName !== 'write_file_text') return events;
  const relativePath = typeof args?.relative_path === 'string' ? args.relative_path.trim() : '';
  if (!relativePath) return events;
  try {
    const parsed = JSON.parse(output);
    if (parsed && typeof parsed === 'object' && parsed.error) return events;
  } catch {
    return events;
  }
  events.push(createWorkspaceFileWrittenEvent(relativePath));
  return events;
}

module.exports = {
  createWorkspaceToolAdapter,
};
