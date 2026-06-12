const { isAbortError, createChatAbortError, mergeUsage, describeFetchError } = require('../providers/stream-helpers');
const {
  resolveHistoryCharLimit,
  trimHistoryMessages,
  truncateStaleToolOutputs,
} = require('../chat-history-trim');

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

function returnCancelledChat(wc, PUSH, toolTrace, content = '', usage = null) {
  emitChatProgress(wc, PUSH, { type: 'phase', phase: 'idle' });
  return { cancelled: true, content, toolTrace, usage };
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
      `\n\nDer Nutzer hat gerade folgende ${kind} im Baum ausgewählt: „${selectedRelPath}“. ` +
      `Beziehe dich bei Fragen ohne expliziten Pfad auf diese Auswahl.`;
  }
  return prompt;
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
    let requestUsage = null;

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
    const historyCharLimit = resolveHistoryCharLimit(uiPrefsAll);
    const historyRows = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content ?? '' }));
    const { messages: windowedHistory } = trimHistoryMessages(historyRows, historyCharLimit);
    apiMessages.push(...windowedHistory);

      const tools = workspaceRoot ? workspaceTools : undefined;
      const callbacks = makeStreamCallbacks(wc, PUSH);
      const toolRoundLimit = resolveToolRoundLimit(uiPrefsAll, maxToolRounds);

      // Pusht das Tool-Ereignis als Rohdaten; die deutsche Anzeige-Zeile baut
      // der Renderer (toolCallSummary.js), der die App-Locale kennt.
      const emitToolLine = (phase, entry) => {
        if (wc && !wc.isDestroyed()) {
          wc.send(PUSH.CHAT_TOOL_LINE, { phase, ...entry });
        }
      };

      for (let round = 0; round < toolRoundLimit; round += 1) {
        if (abortSignal.aborted) {
          return returnCancelledChat(wc, PUSH, toolTrace, '', requestUsage);
        }

        emitChatProgress(wc, PUSH, { type: 'phase', phase: 'waiting' });
        callbacks.reset();
        truncateStaleToolOutputs(apiMessages, historyCharLimit);

        const streamed = await provider.streamChatRound({
          config: effectiveConfig,
          model,
          messages: apiMessages,
          tools,
          callbacks,
          abortSignal,
        });

        requestUsage = mergeUsage(requestUsage, streamed.usage);

        if (streamed.cancelled) {
          const partial = streamed.message?.content ?? '';
          return returnCancelledChat(wc, PUSH, toolTrace, partial, requestUsage);
        }

        if (streamed.error) {
          emitChatProgress(wc, PUSH, { type: 'phase', phase: 'idle' });
          return { error: streamed.error, code: streamed.code || 'API', usage: requestUsage };
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
                return returnCancelledChat(wc, PUSH, toolTrace, '', requestUsage);
              }
              const fn = tc.function;
              const toolName = fn?.name || 'tool';
              let args = {};
              try {
                args = JSON.parse(fn?.arguments || '{}');
              } catch {
                args = {};
              }
              const entry = { tool: toolName, args, noWorkspace: true };
              toolTrace.push(entry);
              emitToolLine('start', entry);
              emitToolLine('done', entry);
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
              return returnCancelledChat(wc, PUSH, toolTrace, '', requestUsage);
            }
            const fn = tc.function;
            const toolName = fn?.name;
            let args = {};
            try {
              args = JSON.parse(fn?.arguments || '{}');
            } catch {
              args = {};
            }
            const entry = { tool: toolName, args };
            toolTrace.push(entry);
            emitToolLine('start', entry);
            let out;
            try {
              out = await fsService.runWorkspaceTool(toolName, args, workspaceRoot, { abortSignal });
            } catch (err) {
              if (isAbortError(err)) {
                return returnCancelledChat(wc, PUSH, toolTrace, '', requestUsage);
              }
              throw err;
            }
            emitToolLine('done', entry);
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
          usage: requestUsage,
        };
      }
      emitChatProgress(wc, PUSH, { type: 'phase', phase: 'idle' });
      return {
        error:
          `Zu viele Tool-Runden (aktuell ${toolRoundLimit}). ` +
          'Erhöhe das Limit unter Einstellungen › Allgemein oder formuliere die Frage enger.',
        code: 'TOOL_LIMIT',
        usage: requestUsage,
      };
    } catch (err) {
      if (isAbortError(err)) {
        return returnCancelledChat(wc, PUSH, toolTrace, '', requestUsage);
      }
      emitChatProgress(wc, PUSH, { type: 'phase', phase: 'idle' });
      return { error: describeFetchError(err, 'dem Provider'), code: 'NETWORK' };
    } finally {
      clearActiveChatAbort(wc.id, abortController);
    }
  });
}

module.exports = {
  registerChatHandlers,
  resolveToolRoundLimit,
};
