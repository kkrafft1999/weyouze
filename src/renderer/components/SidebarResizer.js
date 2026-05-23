const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 600;
const CHAT_MIN = 260;

function clampSidebarWidth(raw) {
  return Math.max(SIDEBAR_MIN, Math.min(raw, SIDEBAR_MAX));
}

function maxChatWidth(workspace) {
  if (!workspace) return CHAT_MIN;
  const rect = workspace.getBoundingClientRect();
  return Math.max(CHAT_MIN, Math.min(rect.width * 0.5, rect.width - 200));
}

function clampChatWidth(raw, workspace) {
  return Math.max(CHAT_MIN, Math.min(raw, maxChatWidth(workspace)));
}

function parsePx(styleWidth) {
  const n = parseInt(styleWidth, 10);
  return Number.isFinite(n) ? n : null;
}

export function initSidebarResizer({
  divider,
  sidebar,
  workspace,
  chatDivider,
  chatPanel,
  api,
  initialSidebarWidth,
  initialChatPanelWidth,
}) {
  if (typeof initialSidebarWidth === 'number' && Number.isFinite(initialSidebarWidth)) {
    sidebar.style.width = `${clampSidebarWidth(initialSidebarWidth)}px`;
  }

  if (
    chatPanel
    && typeof initialChatPanelWidth === 'number'
    && Number.isFinite(initialChatPanelWidth)
  ) {
    chatPanel.style.width = `${clampChatWidth(initialChatPanelWidth, workspace)}px`;
  }

  let isResizing = false;
  let isResizingChat = false;

  async function persistPanelWidths() {
    if (!api?.setUIPrefs) return;
    const patch = {};
    const sidebarWidth = parsePx(sidebar.style.width);
    if (sidebarWidth !== null) patch.sidebarWidth = sidebarWidth;
    if (chatPanel) {
      const chatPanelWidth = parsePx(chatPanel.style.width);
      if (chatPanelWidth !== null) patch.chatPanelWidth = chatPanelWidth;
    }
    if (Object.keys(patch).length === 0) return;
    try {
      await api.setUIPrefs(patch);
    } catch {
      // ignore persistence errors
    }
  }

  divider.addEventListener('mousedown', (e) => {
    isResizing = true;
    divider.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (isResizing) {
      const newWidth = clampSidebarWidth(e.clientX);
      sidebar.style.width = `${newWidth}px`;
      return;
    }
    if (isResizingChat && workspace && chatPanel) {
      const rect = workspace.getBoundingClientRect();
      const fromRight = rect.right - e.clientX;
      const w = clampChatWidth(fromRight, workspace);
      chatPanel.style.width = `${w}px`;
    }
  });

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      divider.classList.remove('dragging');
      document.body.style.cursor = '';
      void persistPanelWidths();
    }
    if (isResizingChat) {
      isResizingChat = false;
      chatDivider.classList.remove('dragging');
      document.body.style.cursor = '';
      void persistPanelWidths();
    }
  });

  chatDivider.addEventListener('mousedown', (e) => {
    isResizingChat = true;
    chatDivider.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });
}
