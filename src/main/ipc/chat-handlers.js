const { isAbortError, createChatAbortError, mergeUsage, describeFetchError } = require('../providers/stream-helpers');
const { createRoundRecorder } = require('../llm-raw-log');
const {
  CHAT_ERROR_CODES,
  CHAT_PHASES,
  TOOL_LINE_PHASES,
  resolveDebugWaitMs,
  createChatResult,
  createCancelledChatResult,
  createChatErrorResult,
  createDeltaEvent,
  createToolLineEvent,
  createPhaseEvent,
  createReasoningEvent,
} = require('../../shared/contracts');
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

function returnCancelledChat(wc, PUSH, toolTrace, content = '', usage = null, rawExchanges = []) {
  emitChatProgress(wc, PUSH, createPhaseEvent(CHAT_PHASES.IDLE));
  return createCancelledChatResult({ content, toolTrace, usage, rawExchanges });
}

function workspaceSystemPrompt(
  workspaceRoot,
  selectedRelPath,
  selectedIsDirectory,
  pathMod,
  toolsPrompt
) {
  const name = pathMod.basename(workspaceRoot);
  let prompt =
    `Du hilfst beim Durchsuchen des in der App geöffneten Ordners („${name}“).`;
  if (toolsPrompt) prompt += `\n\n${toolsPrompt}`;
  prompt += `\n\nAntworte auf Deutsch, sachlich und knapp.`;
  if (selectedRelPath) {
    const kind = selectedIsDirectory ? 'Ordner' : 'Datei';
    prompt +=
      `\n\nDer Nutzer hat gerade folgende ${kind} im Baum ausgewählt: „${selectedRelPath}“. ` +
      `Beziehe dich bei Fragen ohne expliziten Pfad auf diese Auswahl.`;
  }
  return prompt;
}

// Baut das Tool-Ereignis, das an den Renderer gepusht und in toolTrace
// persistiert wird. Für debug_wait reicht der Main die bereits geclampte
// Wartezeit (waitMs) mit, damit der Renderer das Label nicht aus den Rohargs
// rekonstruieren (und dabei abdriften) muss.
function buildToolEntry(toolName, args, extra) {
  const entry = { tool: toolName, args, ...extra };
  if (toolName === 'debug_wait') entry.waitMs = resolveDebugWaitMs(args);
  return entry;
}

// Verdichtet einen tool_call (Chat-Completions-Form) auf das, was im
// RAW-Protokoll lesbar angezeigt wird.
function summarizeToolCall(tc) {
  return {
    id: tc?.id || null,
    name: tc?.function?.name || null,
    arguments: typeof tc?.function?.arguments === 'string' ? tc.function.arguments : '',
  };
}

// Kanonischer, kopierbarer Schnappschuss der gesendeten Nachrichten — ohne die
// internen Mutationen von apiMessages spaeter zu spiegeln.
function snapshotMessages(apiMessages) {
  return apiMessages.map((m) => {
    const row = {
      role: m.role,
      content: typeof m.content === 'string' ? m.content : m.content == null ? '' : String(m.content),
    };
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) {
      row.tool_calls = m.tool_calls.map(summarizeToolCall);
    }
    if (m.tool_call_id) row.tool_call_id = m.tool_call_id;
    return row;
  });
}

// Geparste Modell-Antwort (Text + Tool-Aufrufe) fuer die lesbare Anzeige.
function parseResponseMessage(message) {
  if (!message) return null;
  return {
    text: typeof message.content === 'string' ? message.content : '',
    toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls.map(summarizeToolCall) : [],
  };
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
    emitChatProgress(webContents, PUSH, createPhaseEvent(CHAT_PHASES.GENERATING));
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
        webContents.send(PUSH.CHAT_DELTA, createDeltaEvent(text));
      }
    },
    onReasoningDelta(text) {
      if (!text) return;
      markGenerating();
      emitChatProgress(webContents, PUSH, createReasoningEvent(text));
    },
  };
}

function registerChatHandlers({
  ipcMain,
  storage,
  providers,
  toolRegistry,
  path: pathMod,
  defaultProviderId,
  maxToolRounds,
  REQ,
  PUSH,
}) {
  ipcMain.on(REQ.CHAT_ABORT, (event) => {
    abortActiveChat(event.sender.id);
  });

  // Isolierter Einmal-Aufruf: erklaert z. B. einen RAW-Protokoll-Durchlauf.
  // Bewusst getrennt vom normalen Chat — keine Tools, kein Workspace-/System-
  // Prompt, KEINE rawExchanges-Aufzeichnung und keine Abbruch-Registry, damit
  // der Aufruf weder im RAW-Protokoll auftaucht noch einen laufenden Chat stoert.
  ipcMain.handle(REQ.CHAT_EXPLAIN, async (_event, payload) => {
    const messages = payload?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return createChatErrorResult({ error: 'Keine Nachrichten übergeben.', code: CHAT_ERROR_CODES.INVALID });
    }

    const config = await storage.readLLMConfig();
    const chatTarget = storage.resolveChatModelTarget(config);
    const activeId = chatTarget.providerId;
    const provider = providers.getProvider(activeId);
    if (!provider) {
      return createChatErrorResult({ error: `Unbekannter Provider: ${activeId}.`, code: CHAT_ERROR_CODES.INVALID });
    }
    const providerConfig = await storage.getEffectiveProviderConfig(activeId);
    const model = chatTarget.model || providerConfig?.model || provider.defaultModel;
    const effectiveConfig =
      chatTarget.reasoningEffort && activeId === 'openai'
        ? { ...providerConfig, reasoningEffort: chatTarget.reasoningEffort }
        : providerConfig;

    if (provider.fields?.apiKey && !providerConfig?.apiKey) {
      return createChatErrorResult({ error: `Kein API-Key für ${provider.name} hinterlegt.`, code: CHAT_ERROR_CODES.NO_API_KEY });
    }
    if (provider.fields?.baseUrl && !providerConfig?.baseUrl) {
      return createChatErrorResult({ error: `Keine Server-URL für ${provider.name} hinterlegt.`, code: CHAT_ERROR_CODES.NO_BASE_URL });
    }

    const apiMessages = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content ?? '' }));
    if (apiMessages.length === 0) {
      return createChatErrorResult({ error: 'Keine gültigen Nachrichten.', code: CHAT_ERROR_CODES.INVALID });
    }

    const noopCallbacks = {
      reset() {},
      onMarkGenerating() {},
      onTextDelta() {},
      onReasoningDelta() {},
    };
    const controller = new AbortController();
    try {
      const streamed = await provider.streamChatRound({
        config: effectiveConfig,
        model,
        messages: apiMessages,
        tools: undefined,
        callbacks: noopCallbacks,
        abortSignal: controller.signal,
        // kein recorder → keine RAW-Aufzeichnung
      });
      if (streamed.error) return createChatErrorResult({ error: streamed.error, code: streamed.code || CHAT_ERROR_CODES.API });
      return { content: streamed.message?.content ?? '' };
    } catch (err) {
      return createChatErrorResult({ error: describeFetchError(err, 'dem Provider'), code: CHAT_ERROR_CODES.NETWORK });
    }
  });

  ipcMain.handle(REQ.CHAT_SEND, async (event, payload) => {
    const wc = event.sender;
    const abortController = new AbortController();
    const abortSignal = abortController.signal;
    setActiveChatAbort(wc.id, abortController);
    const toolTrace = [];
    // Rohes Protokoll aller LLM-Runden dieses Sendevorgangs (RAW-LLM-Log).
    const rawExchanges = [];
    let requestUsage = null;

    try {
      const messages = payload?.messages;
      if (!Array.isArray(messages) || messages.length === 0) {
        return createChatErrorResult({ error: 'Keine Nachrichten übergeben.', code: CHAT_ERROR_CODES.INVALID });
      }

    const config = await storage.readLLMConfig();
    const chatTarget = storage.resolveChatModelTarget(config);
    const activeId = chatTarget.providerId;
    const provider = providers.getProvider(activeId);
    if (!provider) {
      return createChatErrorResult({ error: `Unbekannter Provider: ${activeId}.`, code: CHAT_ERROR_CODES.INVALID });
    }
    const providerConfig = await storage.getEffectiveProviderConfig(activeId);
    const model = chatTarget.model || providerConfig?.model || provider.defaultModel;
    const effectiveConfig =
      chatTarget.reasoningEffort && activeId === 'openai'
        ? { ...providerConfig, reasoningEffort: chatTarget.reasoningEffort }
        : providerConfig;

    if (provider.fields?.apiKey && !providerConfig?.apiKey) {
      return createChatErrorResult({
        error: `Kein API-Key für ${provider.name} hinterlegt. Bitte in den Einstellungen speichern.`,
        code: CHAT_ERROR_CODES.NO_API_KEY,
      });
    }
    if (provider.fields?.baseUrl && !providerConfig?.baseUrl) {
      return createChatErrorResult({
        error: `Keine Server-URL für ${provider.name} hinterlegt.`,
        code: CHAT_ERROR_CODES.NO_BASE_URL,
      });
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
    const allowWrite = uiPrefsAll.allowWorkspaceWrite === true;
    const toolOptions = { allowWrite };

    const apiMessages = [];
    const workspaceSystem = workspaceRoot
      ? workspaceSystemPrompt(
          workspaceRoot,
          selectedRelPath,
          selectedIsDirectory,
          pathMod,
          toolRegistry.buildSystemPrompt(toolOptions)
        )
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

      const tools = workspaceRoot ? toolRegistry.getTools(toolOptions) : undefined;
      const callbacks = makeStreamCallbacks(wc, PUSH);
      const toolRoundLimit = resolveToolRoundLimit(uiPrefsAll, maxToolRounds);

      // Pusht das Tool-Ereignis als Rohdaten; die deutsche Anzeige-Zeile baut
      // der Renderer (toolCallSummary.js), der die App-Locale kennt.
      const emitToolLine = (phase, entry) => {
        if (wc && !wc.isDestroyed()) {
          wc.send(PUSH.CHAT_TOOL_LINE, createToolLineEvent(phase, entry));
        }
      };

      for (let round = 0; round < toolRoundLimit; round += 1) {
        if (abortSignal.aborted) {
          return returnCancelledChat(wc, PUSH, toolTrace, '', requestUsage, rawExchanges);
        }

        emitChatProgress(wc, PUSH, createPhaseEvent(CHAT_PHASES.WAITING));
        callbacks.reset();
        truncateStaleToolOutputs(apiMessages, historyCharLimit);

        const recorder = createRoundRecorder();
        // Snapshot der exakt jetzt gesendeten Konversation (lesbare, kanonische
        // Sicht — unabhaengig vom provider-spezifischen Roh-Body).
        const sentMessages = snapshotMessages(apiMessages);
        const streamed = await provider.streamChatRound({
          config: effectiveConfig,
          model,
          messages: apiMessages,
          tools,
          callbacks,
          abortSignal,
          recorder,
        });

        rawExchanges.push(
          recorder.toExchange({
            providerId: activeId,
            model,
            round,
            ts: Date.now(),
            finishReason: streamed.finishReason,
            cancelled: !!streamed.cancelled,
            error: streamed.error || null,
            usage: streamed.usage || null,
            messages: sentMessages,
            response: parseResponseMessage(streamed.message),
          })
        );

        requestUsage = mergeUsage(requestUsage, streamed.usage);

        if (streamed.cancelled) {
          const partial = streamed.message?.content ?? '';
          return returnCancelledChat(wc, PUSH, toolTrace, partial, requestUsage, rawExchanges);
        }

        if (streamed.error) {
          emitChatProgress(wc, PUSH, createPhaseEvent(CHAT_PHASES.IDLE));
          return createChatErrorResult({
            error: streamed.error,
            code: streamed.code || CHAT_ERROR_CODES.API,
            usage: requestUsage,
            rawExchanges,
          });
        }

        const assistantMsg = streamed.message;
        if (!assistantMsg) {
          return createChatErrorResult({ error: 'Ungültige Antwort der API.', code: CHAT_ERROR_CODES.INVALID });
        }

        apiMessages.push(assistantMsg);

        const toolCalls = assistantMsg.tool_calls;
        if (Array.isArray(toolCalls) && toolCalls.length > 0) {
          if (!workspaceRoot) {
            for (const tc of toolCalls) {
              if (abortSignal.aborted) {
                return returnCancelledChat(wc, PUSH, toolTrace, '', requestUsage, rawExchanges);
              }
              const fn = tc.function;
              const toolName = fn?.name || 'tool';
              let args = {};
              try {
                args = JSON.parse(fn?.arguments || '{}');
              } catch {
                args = {};
              }
              const entry = buildToolEntry(toolName, args, { noWorkspace: true });
              toolTrace.push(entry);
              emitToolLine(TOOL_LINE_PHASES.START, entry);
              emitToolLine(TOOL_LINE_PHASES.DONE, entry);
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
              return returnCancelledChat(wc, PUSH, toolTrace, '', requestUsage, rawExchanges);
            }
            const fn = tc.function;
            const toolName = fn?.name;
            let args = {};
            try {
              args = JSON.parse(fn?.arguments || '{}');
            } catch {
              args = {};
            }
            const entry = buildToolEntry(toolName, args);
            toolTrace.push(entry);
            emitToolLine(TOOL_LINE_PHASES.START, entry);
            let out;
            try {
              out = await toolRegistry.execute(toolName, args, {
                workspaceRoot,
                abortSignal,
                allowWrite,
              });
            } catch (err) {
              if (isAbortError(err)) {
                return returnCancelledChat(wc, PUSH, toolTrace, '', requestUsage, rawExchanges);
              }
              throw err;
            }
            emitToolLine(TOOL_LINE_PHASES.DONE, entry);
            apiMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: out,
            });
          }
          continue;
        }

        emitChatProgress(wc, PUSH, createPhaseEvent(CHAT_PHASES.IDLE));
        return createChatResult({
          content: assistantMsg.content ?? '',
          toolTrace,
          usage: requestUsage,
          rawExchanges,
        });
      }
      emitChatProgress(wc, PUSH, createPhaseEvent(CHAT_PHASES.IDLE));
      return createChatErrorResult({
        error:
          `Zu viele Tool-Runden (aktuell ${toolRoundLimit}). ` +
          'Erhöhe das Limit unter Einstellungen › Allgemein oder formuliere die Frage enger.',
        code: CHAT_ERROR_CODES.TOOL_LIMIT,
        usage: requestUsage,
        rawExchanges,
      });
    } catch (err) {
      if (isAbortError(err)) {
        return returnCancelledChat(wc, PUSH, toolTrace, '', requestUsage, rawExchanges);
      }
      emitChatProgress(wc, PUSH, createPhaseEvent(CHAT_PHASES.IDLE));
      return createChatErrorResult({
        error: describeFetchError(err, 'dem Provider'),
        code: CHAT_ERROR_CODES.NETWORK,
        rawExchanges,
      });
    } finally {
      clearActiveChatAbort(wc.id, abortController);
    }
  });
}

module.exports = {
  registerChatHandlers,
  resolveToolRoundLimit,
};
