function workspaceSystemPrompt(workspaceRoot, selectedRelPath, selectedIsDirectory, pathMod) {
  const name = pathMod.basename(workspaceRoot);
  let prompt =
    `Du hilfst beim Durchsuchen des in der App geöffneten Ordners („${name}“). ` +
    `Du hast die Tools list_directory und read_file_text. Nutze nur relative Pfade zum Ordnerroot ` +
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

function summarizeToolCall(toolName, args) {
  if (toolName === 'list_directory') {
    const p =
      typeof args.relative_path === 'string' && args.relative_path.trim()
        ? args.relative_path.trim()
        : '.';
    return `list_directory(${truncateToolLabel(p)})`;
  }
  if (toolName === 'read_file_text') {
    const p = typeof args.relative_path === 'string' ? args.relative_path.trim() : '?';
    return `read_file_text(${truncateToolLabel(p)})`;
  }
  return truncateToolLabel(toolName || 'tool');
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
  ipcMain.handle(REQ.CHAT_SEND, async (event, payload) => {
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
    if (chatTarget.reasoningEffort && activeId === 'openai') {
      providerConfig.reasoningEffort = chatTarget.reasoningEffort;
    }

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
    const toolTrace = [];
    const wc = event.sender;
    const callbacks = makeStreamCallbacks(wc, PUSH);
    const toolRoundLimit = resolveToolRoundLimit(uiPrefsAll, maxToolRounds);

    const emitToolLine = (line) => {
      if (wc && !wc.isDestroyed()) {
        wc.send(PUSH.CHAT_TOOL_LINE, { line });
      }
    };

    try {
      for (let round = 0; round < toolRoundLimit; round += 1) {
        emitChatProgress(wc, PUSH, { type: 'phase', phase: 'waiting' });
        callbacks.reset();

        const streamed = await provider.streamChatRound({
          config: providerConfig,
          model,
          messages: apiMessages,
          tools,
          callbacks,
        });

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
              const fn = tc.function;
              const toolName = fn?.name || 'tool';
              let args = {};
              try {
                args = JSON.parse(fn?.arguments || '{}');
              } catch {
                args = {};
              }
              const line = `${summarizeToolCall(toolName, args)} · kein Ordner geöffnet`;
              toolTrace.push(line);
              emitToolLine(line);
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
            const fn = tc.function;
            const toolName = fn?.name;
            let args = {};
            try {
              args = JSON.parse(fn?.arguments || '{}');
            } catch {
              args = {};
            }
            const line = summarizeToolCall(toolName, args);
            toolTrace.push(line);
            emitToolLine(line);
            const out = await fsService.runWorkspaceTool(toolName, args, workspaceRoot);
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
      emitChatProgress(wc, PUSH, { type: 'phase', phase: 'idle' });
      return { error: err.message || 'Netzwerkfehler', code: 'NETWORK' };
    }
  });
}

module.exports = { registerChatHandlers };
