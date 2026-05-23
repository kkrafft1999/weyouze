const { formatPauseDurationLabel, resolveDebugWaitMs } = require('../debug-wait');
const { isAbortError, createChatAbortError } = require('../providers/stream-helpers');

/** @type {Map<number, AbortController>} */
const activeChatAborts = new Map();

function setActiveChatAbort(webContentsId, controller) {
  const prev = activeChatAborts.get(webContentsId);
  if (prev && prev !== controller && !prev.signal.aborted) {
    prev.abort(createChatAbortError());
  }
  activeChatAborts.set(webContentsId, controller);
}

function clearActiveChatAbort(webContentsId, controller) {
  if (activeChatAborts.get(webContentsId) === controller) {
    activeChatAborts.delete(webContentsId);
  }
}

function abortActiveChat(webContentsId) {
  const controller = activeChatAborts.get(webContentsId);
  if (controller && !controller.signal.aborted) {
    controller.abort(createChatAbortError());
  }
}

function returnCancelledChat(wc, PUSH, toolTrace, content = '') {
  emitChatProgress(wc, PUSH, { type: 'phase', phase: 'idle' });
  return { cancelled: true, content, toolTrace };
}

function workspaceSystemPrompt(workspaceRoot, selectedRelPath, selectedIsDirectory, pathMod) {
  const name = pathMod.basename(workspaceRoot);
  let prompt =
    `Du hilfst beim Durchsuchen des in der App geöffneten Ordners („${name}“). ` +
    `Du hast die Tools list_directory, read_file_text und debug_wait (nur UI-Test). Nutze nur relative Pfade zum Ordnerroot ` +
    `(z. B. "" oder "." für die Wurzel, "src/index.js" für eine Datei). ` +
    `Antworte auf Deutsch, sachlich und knapp.`;
  if (selectedRelPath) {
    const kind = selectedIsDirectory ? 'Ordner' : 'Datei';
    prompt +=
      `\n\nDer Nutzer hat gerade folgende ${kind} im Baum ausgewählt: „${selectedRelPath}". ` +
      `Beziehe dich bei Fragen ohne expliziten Pfad auf diese Auswahl.`;
  }
  return prompt;
}

function truncateToolLabel(s, max = 48) {
  const t = String(s ?? '');
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function formatRelativePathForLabel(relativePath) {
  const raw = typeof relativePath === 'string' ? relativePath.trim() : '';
  if (!raw || raw === '.') return null;
  return truncateToolLabel(raw);
}

function summarizeToolCall(toolName, args, phase = 'start') {
  const isDone = phase === 'done';
  if (toolName === 'list_directory') {
    const pathLabel = formatRelativePathForLabel(args?.relative_path);
    if (pathLabel) {
      return isDone ? `Ordner ${pathLabel} durchsucht` : `Ordner ${pathLabel} wird durchsucht …`;
    }
    return isDone ? 'Projektordner durchsucht' : 'Projektordner wird durchsucht …';
  }
  if (toolName === 'read_file_text') {
    const pathLabel = formatRelativePathForLabel(args?.relative_path);
    if (pathLabel) {
      return isDone ? `Datei ${pathLabel} gelesen` : `Datei ${pathLabel} wird gelesen …`;
    }
    return isDone ? 'Datei gelesen' : 'Datei wird gelesen …';
  }
  if (toolName === 'debug_wait') {
    return formatPauseDurationLabel(resolveDebugWaitMs(args), phase);
  }
  const name = truncateToolLabel(toolName || 'Tool');
  return isDone ? `${name} ausgeführt` : `${name} wird ausgeführt …`;
}

function resolveToolRoundLimit(uiPrefs, mainDefault) {
  const MIN = 1;
  const MAX_CAP = 500;
  let n =
    typeof uiPrefs?.maxToolRounds === 'number' && Number.isFinite(uiPrefs.maxToolRounds)
      ? Math.round(uiPrefs.maxToolRounds)
      : mainDefault;
  if (!Number.isFinite(n)) n = mainDefault;
  return Math.min(MAX_CAP, Math.max(MIN, n));
}

function emitChatProgress(webContents, PUSH, payload) {
  if (webContents && !webContents.isDestroyed()) {
    webContents.send(PUSH.CHAT_PROGRESS, payload);
  }
}

function makeStreamCallbacks(webContents, PUSH) {
  let started = false;
  const markGenerating = () => {
    if (started) return;
    started = true;
    emitChatProgress(webContents, PUSH, { type: 'phase', phase: 'generating' });
  };
  return {
    reset() {
      started = false;
    },
    onMarkGenerating: markGenerating,
    onTextDelta(text) {
      if (!text) return;
      markGenerating();
      if (webContents && !webContents.isDestroyed()) {
        webContents.send(PUSH.CHAT_DELTA, { text });
      }
    },
    onReasoningDelta(text) {
      if (!text) return;
      markGenerating();
      emitChatProgress(webContents, PUSH, { type: 'reasoning', text });
    },
  };
}

function registerChatHandlers({
  ipcMain,
  storage,
  providers,
  fsService,
  path: pathMod,
  defaultProviderId,
  maxToolRounds,
  workspaceTools,
  REQ,
  PUSH,
}) {
  ipcMain.on(REQ.CHAT_ABORT, (event) => {
    abortActiveChat(event.sender.id);
  });

  ipcMain.handle(REQ.CHAT_SEND, async (event, payload) => {
    const wc = event.sender;
    const abortController = new AbortController();
    const abortSignal = abortController.signal;
    setActiveChatAbort(wc.id, abortController);
    const toolTrace = [];

    try {
      const messages = payload?.messages;
      if (!Array.isArray(messages) || messages.length === 0) {
        return { error: 'Keine Nachrichten übergeben.', code: 'INVALID' };
      }

    const config = await storage.readLLMConfig();
    const chatTarget = storage.resolveChatModelTarget(config);
    const activeId = chatTarget.providerId;
    const provider = providers.getProvider(activeId);
    if (!provider) {
      return { error: `Unbekannter Provider: ${activeId}.`, code: 'INVALID' };
    }
    const providerConfig = await storage.getEffectiveProviderConfig(activeId);
    const model = chatTarget.model || providerConfig?.model || provider.defaultModel;
    const effectiveConfig =
      chatTarget.reasoningEffort && activeId === 'openai'
        ? { ...providerConfig, reasoningEffort: chatTarget.reasoningEffort }
        : providerConfig;

    if (provider.fields?.apiKey && !providerConfig?.apiKey) {
      return {
        error: `Kein API-Key für ${provider.name} hinterlegt. Bitte in den Einstellungen speichern.`,
        code: 'NO_API_KEY',
      };
    }
    if (provider.fields?.baseUrl && !providerConfig?.baseUrl) {
      return {
        error: `Keine Server-URL für ${provider.name} hinterlegt.`,
        code: 'NO_BASE_URL',
      };
    }

    const rawRoot = payload?.workspaceRoot;
    const workspaceRoot =
      typeof rawRoot === 'string' && rawRoot.trim() ? pathMod.resolve(rawRoot.trim()) : null;

    let selectedRelPath = null;
    let selectedIsDirectory = false;
    if (workspaceRoot && typeof payload?.selectedPath === 'string' && payload.selectedPath.trim()) {
      const abs = pathMod.resolve(payload.selectedPath.trim());
      const rel = pathMod.relative(workspaceRoot, abs);
      if (!rel.startsWith('..') && !pathMod.isAbsolute(rel)) {
        selectedRelPath = rel || '.';
        selectedIsDirectory = !!payload.selectedIsDirectory;
      }
    }

    const uiPrefsAll = await storage.readUIPrefs();
    const extraSystem =
      typeof uiPrefsAll.baseSystemPrompt === 'string' ? uiPrefsAll.baseSystemPrompt.trim() : '';

    const apiMessages = [];
    const workspaceSystem = workspaceRoot
      ? workspaceSystemPrompt(workspaceRoot, selectedRelPath, selectedIsDirectory, pathMod)
      : '';
    let combinedSystem = workspaceSystem;
    if (extraSystem && combinedSystem) {
      combinedSystem = `${extraSystem}\n\n${combinedSystem}`;
    } else if (extraSystem) {
      combinedSystem = extraSystem;
    }

    if (combinedSystem) {
      apiMessages.push({
        role: 'system',
        content: combinedSystem,
      });
    }
    for (const m of messages) {
      if (m.role === 'user' || m.role === 'assistant') {
        apiMessages.push({ role: m.role, content: m.content ?? '' });
      }
    }

      const tools = workspaceRoot ? workspaceTools : undefined;
      const callbacks = makeStreamCallbacks(wc, PUSH);
      const toolRoundLimit = resolveToolRoundLimit(uiPrefsAll, maxToolRounds);

      const emitToolLine = (phase, line) => {
        if (wc && !wc.isDestroyed()) {
          wc.send(PUSH.CHAT_TOOL_LINE, { phase, line });
        }
      };

      for (let round = 0; round < toolRoundLimit; round += 1) {
        if (abortSignal.aborted) {
          return returnCancelledChat(wc, PUSH, toolTrace);
        }

        emitChatProgress(wc, PUSH, { type: 'phase', phase: 'waiting' });
        callbacks.reset();

        const streamed = await provider.streamChatRound({
          config: effectiveConfig,
          model,
          messages: apiMessages,
          tools,
          callbacks,
          abortSignal,
        });

        if (streamed.cancelled) {
          const partial = streamed.message?.content ?? '';
          return returnCancelledChat(wc, PUSH, toolTrace, partial);
        }

        if (streamed.error) {
          emitChatProgress(wc, PUSH, { type: 'phase', phase: 'idle' });
          return { error: streamed.error, code: streamed.code || 'API' };
        }

        const assistantMsg = streamed.message;
        if (!assistantMsg) {
          return { error: 'Ungültige Antwort der API.', code: 'INVALID' };
        }

        apiMessages.push(assistantMsg);

        const toolCalls = assistantMsg.tool_calls;
        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
          if (!workspaceRoot) {
            for (const tc of toolCalls) {
              if (abortSignal.aborted) {
                return returnCancelledChat(wc, PUSH, toolTrace);
              }
              const fn = tc.function;
              const toolName = fn?.name || 'tool';
              let args = {};
              try {
                args = JSON.parse(fn?.arguments || '{}');
              } catch {
                args = {};
              }
              const startLine = `${summarizeToolCall(toolName, args, 'start')} · kein Ordner geöffnet`;
              const doneLine = `${summarizeToolCall(toolName, args, 'done')} · kein Ordner geöffnet`;
              toolTrace.push(doneLine);
              emitToolLine('start', startLine);
              emitToolLine('done', doneLine);
              apiMessages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify({
                  error: 'Kein Arbeitsordner geöffnet; Tools nicht verfügbar.',
                }),
              });
            }
            continue;
          }
          for (const tc of toolCalls) {
            if (abortSignal.aborted) {
              return returnCancelledChat(wc, PUSH, toolTrace);
            }
            const fn = tc.function;
            const toolName = fn?.name;
            let args = {};
            try {
              args = JSON.parse(fn?.arguments || '{}');
            } catch {
              args = {};
            }
            const startLine = summarizeToolCall(toolName, args, 'start');
            const doneLine = summarizeToolCall(toolName, args, 'done');
            toolTrace.push(doneLine);
            emitToolLine('start', startLine);
            let out;
            try {
              out = await fsService.runWorkspaceTool(toolName, args, workspaceRoot, { abortSignal });
            } catch (err) {
              if (isAbortError(err)) {
                return returnCancelledChat(wc, PUSH, toolTrace);
              }
              throw err;
            }
            emitToolLine('done', doneLine);
            apiMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: out,
            });
          }
          continue;
        }

        emitChatProgress(wc, PUSH, { type: 'phase', phase: 'idle' });
        return {
          content: assistantMsg.content ?? '',
          toolTrace,
        };
      }
      emitChatProgress(wc, PUSH, { type: 'phase', phase: 'idle' });
      return {
        error:
          `Zu viele Tool-Runden (aktuell ${toolRoundLimit}). ` +
          'Erhöhe das Limit unter Einstellungen › Allgemein oder formuliere die Frage enger.',
        code: 'TOOL_LIMIT',
      };
    } catch (err) {
      if (isAbortError(err)) {
        return returnCancelledChat(wc, PUSH, toolTrace);
      }
      emitChatProgress(wc, PUSH, { type: 'phase', phase: 'idle' });
      return { error: err.message || 'Netzwerkfehler', code: 'NETWORK' };
    } finally {
      clearActiveChatAbort(wc.id, abortController);
    }
  });
}

module.exports = {
  registerChatHandlers,
  resolveToolRoundLimit,
  summarizeToolCall,
  truncateToolLabel,
};
