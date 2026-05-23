import { markdownToSafeHtml } from '../utils/helpers.js';
import {
  inferChatTitle,
  serializeChatMessagesForStorage,
  normalizeLoadedMessages,
} from '../chat/messageUtils.js';

export function initChatStream({
  api,
  appStore,
  chatMessagesEl,
  chatInput,
  btnChatSend,
  onInputChanged,
  stopChatVoiceListening,
  activeProviderConfigured,
  syncLiveDot,
}) {
  function buildToolStatusBadge(state /* 'running' | 'done' */) {
    const wrap = document.createElement('span');
    wrap.className = 'chat-tool-status';
    if (state === 'running') {
      const dot = document.createElement('span');
      dot.className = 'chat-tool-status-dot';
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', 'Aktiv');
      wrap.appendChild(dot);
      const pill = document.createElement('span');
      pill.className = 'chat-pill chat-pill--running';
      pill.setAttribute('lang', 'en');
      const sr = document.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = 'Status: ';
      pill.appendChild(sr);
      pill.appendChild(document.createTextNode('RUNNING'));
      wrap.appendChild(pill);
    } else {
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('class', 'chat-tool-status-check');
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', 'Abgeschlossen');
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', 'M3 8l3 3 7-7');
      svg.appendChild(path);
      wrap.appendChild(svg);
      const pill = document.createElement('span');
      pill.className = 'chat-pill chat-pill--done';
      pill.setAttribute('lang', 'en');
      const sr = document.createElement('span');
      sr.className = 'sr-only';
      sr.textContent = 'Status: ';
      pill.appendChild(sr);
      pill.appendChild(document.createTextNode('DONE'));
      wrap.appendChild(pill);
    }
    return wrap;
  }

  function buildToolLog(trace, state /* 'running' | 'done' */) {
    const log = document.createElement('details');
    log.className = 'chat-tool-log';
    log.classList.add(state === 'running' ? 'chat-tool-log--running' : 'chat-tool-log--done');
    if (state === 'running') log.open = true;

    const summary = document.createElement('summary');
    summary.className = 'chat-tool-summary';

    const summaryText = document.createElement('span');
    summaryText.className = 'chat-tool-summary-text';
    summary.appendChild(summaryText);

    summary.appendChild(buildToolStatusBadge(state));
    log.appendChild(summary);

    const lines = document.createElement('div');
    lines.className = 'chat-tool-lines';
    log.appendChild(lines);

    if (Array.isArray(trace) && trace.length > 0) {
      for (const line of trace) {
        const row = document.createElement('div');
        row.className = 'chat-tool-line';
        row.textContent = typeof line === 'string' ? line : line.summary || '';
        lines.appendChild(row);
      }
      const lastLine = trace[trace.length - 1];
      summaryText.textContent =
        typeof lastLine === 'string' ? lastLine : lastLine.summary || '';
    }
    return log;
  }

  function syncChatBusyState() {
    const last = appStore.chatMessages[appStore.chatMessages.length - 1];
    const busy = !!(last && last.role === 'assistant' && last.streaming);
    chatMessagesEl.setAttribute('aria-busy', busy ? 'true' : 'false');
    syncLiveDot();
  }

  function scheduleStreamRender(streamEl, text) {
    if (!streamEl) return;
    if (appStore.streamRenderRaf) cancelAnimationFrame(appStore.streamRenderRaf);
    appStore.streamRenderRaf = requestAnimationFrame(() => {
      appStore.streamRenderRaf = 0;
      streamEl.innerHTML = markdownToSafeHtml(text);
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    });
  }

  function updateStreamingChrome() {
    const last = appStore.chatMessages[appStore.chatMessages.length - 1];
    if (!last?.streaming) return;
    const bubble = chatMessagesEl.querySelector('.chat-msg.assistant:last-of-type');
    if (!bubble) return;
    const phase = bubble.querySelector('.chat-phase');
    if (phase) {
      const ph = last.phase;
      if (ph === 'generating' || ph === 'idle') {
        phase.classList.add('hidden');
        phase.textContent = '';
      } else {
        phase.classList.remove('hidden');
        phase.textContent = 'Modell denkt nach …';
      }
    }
    const reasoningEl = bubble.querySelector('.chat-reasoning-stream');
    if (reasoningEl) {
      reasoningEl.textContent = last.reasoningText || '';
      if (last.reasoningText && last.reasoningText.length > 0) {
        reasoningEl.classList.remove('hidden');
      } else {
        reasoningEl.classList.add('hidden');
      }
    }
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  function renderChatMessages() {
    chatMessagesEl.innerHTML = '';
    for (const m of appStore.chatMessages) {
      const li = document.createElement('li');
      const roleClass = m.role === 'user' ? 'user' : 'assistant';
      li.classList.add('chat-msg', roleClass);
      if (m.isError) li.classList.add('error');
      if (m.role === 'assistant' && !m.isError) {
        if (m.streaming) {
          const phaseEl = document.createElement('div');
          phaseEl.className = 'chat-phase';
          if (m.phase === 'generating' || m.phase === 'idle') {
            phaseEl.classList.add('hidden');
          } else {
            phaseEl.textContent = 'Modell denkt nach …';
          }
          li.appendChild(phaseEl);

          const reasoningEl = document.createElement('pre');
          reasoningEl.className = 'chat-reasoning-stream';
          reasoningEl.textContent = m.reasoningText || '';
          if (!(m.reasoningText && m.reasoningText.length)) {
            reasoningEl.classList.add('hidden');
          }
          li.appendChild(reasoningEl);

          li.appendChild(buildToolLog(m.toolTrace, 'running'));

          const stream = document.createElement('div');
          stream.className = 'chat-md-streaming chat-md';
          stream.innerHTML = markdownToSafeHtml(m.content || '');
          li.appendChild(stream);
        } else {
          if (Array.isArray(m.toolTrace) && m.toolTrace.length > 0) {
            li.appendChild(buildToolLog(m.toolTrace, 'done'));
          }
          if (m.reasoningText && m.reasoningText.trim()) {
            const det = document.createElement('details');
            det.className = 'chat-reasoning-details';
            const sum = document.createElement('summary');
            sum.textContent = 'Zwischenschritte (Modell)';
            const body = document.createElement('pre');
            body.className = 'chat-reasoning-body';
            body.textContent = m.reasoningText;
            det.appendChild(sum);
            det.appendChild(body);
            li.appendChild(det);
          }
          const inner = document.createElement('div');
          inner.className = 'chat-md';
          inner.innerHTML = markdownToSafeHtml(m.content);
          li.appendChild(inner);
        }
      } else {
        li.textContent = m.content;
      }
      chatMessagesEl.appendChild(li);
    }
    syncChatBusyState();
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }

  async function persistCurrentChat() {
    if (!appStore.currentChatId || appStore.chatMessages.length === 0) return;
    const messages = serializeChatMessagesForStorage(appStore.chatMessages);
    if (messages.length === 0) return;
    const title = inferChatTitle(appStore.chatMessages);
    await api.upsertChatSession({
      id: appStore.currentChatId,
      workspaceRoot: appStore.currentChatWorkspace,
      title,
      updatedAt: Date.now(),
      messages,
    });
    await api.setActiveChatId(appStore.currentChatWorkspace, appStore.currentChatId);
  }

  async function loadChatForWorkspace(workspaceRoot) {
    stopChatVoiceListening();
    await persistCurrentChat();
    appStore.chatSessionId += 1;

    const hist = await api.getChatHistory(workspaceRoot);
    const sessions = Array.isArray(hist?.sessions) ? hist.sessions : [];
    if (hist?.activeChatId) {
      const s = sessions.find((x) => x.id === hist.activeChatId);
      if (s && Array.isArray(s.messages)) {
        appStore.currentChatId = s.id;
        appStore.currentChatWorkspace = workspaceRoot || null;
        appStore.chatMessages = normalizeLoadedMessages(s.messages);
        chatInput.value = '';
        onInputChanged();
        renderChatMessages();
        return;
      }
      await api.setActiveChatId(workspaceRoot, null);
    }
    appStore.currentChatId = crypto.randomUUID();
    appStore.currentChatWorkspace = workspaceRoot || null;
    appStore.chatMessages = [];
    chatInput.value = '';
    onInputChanged();
    renderChatMessages();
  }

  async function startNewChat() {
    stopChatVoiceListening();
    await persistCurrentChat();
    appStore.chatSessionId += 1;
    appStore.currentChatId = crypto.randomUUID();
    appStore.currentChatWorkspace = appStore.rootPath || null;
    appStore.chatMessages = [];
    chatInput.value = '';
    onInputChanged();
    await api.setActiveChatId(appStore.currentChatWorkspace, null);
    renderChatMessages();
  }

  async function sendChatMessage() {
    stopChatVoiceListening();
    const text = chatInput.value.trim();
    if (!text || !activeProviderConfigured()) return;
    const sessionAtSend = appStore.chatSessionId;
    chatInput.value = '';
    onInputChanged();
    appStore.chatMessages.push({ role: 'user', content: text });
    renderChatMessages();
    btnChatSend.disabled = true;

    const payload = appStore.chatMessages.map(({ role, content }) => ({ role, content }));
    appStore.chatMessages.push({
      role: 'assistant',
      content: '',
      toolTrace: [],
      reasoningText: '',
      streaming: true,
      phase: 'waiting',
    });
    renderChatMessages();

    const offDelta =
      typeof api.onChatDelta === 'function'
        ? api.onChatDelta(({ text: deltaText }) => {
            const last = appStore.chatMessages[appStore.chatMessages.length - 1];
            if (!last || last.role !== 'assistant' || !last.streaming) return;
            last.content = (last.content || '') + (deltaText || '');
            const streamEl = chatMessagesEl.querySelector(
              '.chat-msg.assistant:last-of-type .chat-md-streaming'
            );
            if (streamEl) {
              scheduleStreamRender(streamEl, last.content);
            } else {
              renderChatMessages();
            }
          })
        : () => {};

    const offTool =
      typeof api.onChatToolLine === 'function'
        ? api.onChatToolLine(({ line }) => {
            const last = appStore.chatMessages[appStore.chatMessages.length - 1];
            if (!last || last.role !== 'assistant' || !last.streaming) return;
            if (!Array.isArray(last.toolTrace)) last.toolTrace = [];
            last.toolTrace.push(line);
            const wrap = chatMessagesEl.querySelector('.chat-msg.assistant:last-of-type .chat-tool-log');
            if (wrap) {
              const linesEl = wrap.querySelector('.chat-tool-lines');
              const sumTextEl = wrap.querySelector('.chat-tool-summary-text');
              const row = document.createElement('div');
              row.className = 'chat-tool-line';
              row.textContent = line;
              if (linesEl) linesEl.appendChild(row);
              else wrap.appendChild(row);
              if (sumTextEl) sumTextEl.textContent = line;
              chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
            } else {
              renderChatMessages();
            }
          })
        : () => {};

    const offProgress =
      typeof api.onChatProgress === 'function'
        ? api.onChatProgress((p) => {
            const last = appStore.chatMessages[appStore.chatMessages.length - 1];
            if (!last || last.role !== 'assistant' || !last.streaming) return;
            if (p.type === 'phase' && p.phase) {
              last.phase = p.phase;
              updateStreamingChrome();
            }
            if (p.type === 'reasoning' && p.text) {
              last.reasoningText = (last.reasoningText || '') + p.text;
              updateStreamingChrome();
            }
          })
        : () => {};

    let result;
    try {
      result = await api.chat(payload, {
        workspaceRoot: appStore.rootPath,
        selectedPath: appStore.selectedPath,
        selectedIsDirectory: appStore.selectedIsDirectory,
      });
    } finally {
      offDelta();
      offTool();
      offProgress();
    }

    btnChatSend.disabled = !activeProviderConfigured();
    if (sessionAtSend !== appStore.chatSessionId) return;

    const last = appStore.chatMessages[appStore.chatMessages.length - 1];
    if (result.error) {
      if (last && last.streaming) {
        appStore.chatMessages.pop();
      }
      appStore.chatMessages.push({ role: 'assistant', content: result.error, isError: true });
    } else if (last && last.role === 'assistant' && last.streaming) {
      last.streaming = false;
      last.content = result.content ?? '';
      last.toolTrace = Array.isArray(result.toolTrace) ? result.toolTrace : last.toolTrace || [];
    }
    renderChatMessages();
    await persistCurrentChat();
  }

  chatMessagesEl.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
      e.preventDefault();
      api.openExternal(href);
    }
  });

  btnChatSend.addEventListener('click', sendChatMessage);

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  });

  return {
    renderChatMessages,
    persistCurrentChat,
    loadChatForWorkspace,
    startNewChat,
    sendChatMessage,
  };
}
