function registerChatHistoryHandlers({ ipcMain, storage, REQ }) {
  ipcMain.handle(REQ.CHAT_HISTORY_GET, async (_event, workspaceRoot) => {
    const store = await storage.readChatHistoryStore();
    const wsRoot = storage.normalizeWorkspaceRoot(workspaceRoot);
    const sessions = store.sessions.filter((s) => storage.sessionMatchesWorkspace(s, wsRoot));
    const activeChatId = store.activeByWorkspace[storage.workspaceBucketKey(wsRoot)] || null;
    return { sessions, activeChatId, workspaceRoot: wsRoot };
  });

  ipcMain.handle(REQ.CHAT_HISTORY_UPSERT, async (_event, sessionRow) => {
    const normalized = storage.normalizeSessionForStore(sessionRow);
    if (!normalized) return { ok: false };
    const store = await storage.readChatHistoryStore();
    const idx = store.sessions.findIndex((x) => x.id === normalized.id);
    if (idx >= 0) store.sessions[idx] = normalized;
    else store.sessions.push(normalized);
    store.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    if (store.sessions.length > storage.MAX_CHAT_SESSIONS) {
      const dropped = store.sessions.slice(storage.MAX_CHAT_SESSIONS);
      store.sessions = store.sessions.slice(0, storage.MAX_CHAT_SESSIONS);
      const droppedIds = new Set(dropped.map((s) => s.id));
      for (const [k, v] of Object.entries(store.activeByWorkspace)) {
        if (droppedIds.has(v)) delete store.activeByWorkspace[k];
      }
    }
    await storage.writeChatHistoryStore(store);
    return { ok: true };
  });

  ipcMain.handle(REQ.CHAT_HISTORY_DELETE, async (_event, id) => {
    if (typeof id !== 'string' || !id.trim()) return { ok: false };
    const store = await storage.readChatHistoryStore();
    store.sessions = store.sessions.filter((s) => s.id !== id);
    for (const [k, v] of Object.entries(store.activeByWorkspace)) {
      if (v === id) delete store.activeByWorkspace[k];
    }
    await storage.writeChatHistoryStore(store);
    return { ok: true };
  });

  ipcMain.handle(REQ.CHAT_HISTORY_SET_ACTIVE, async (_event, workspaceRoot, id) => {
    const store = await storage.readChatHistoryStore();
    const wsKey = storage.workspaceBucketKey(storage.normalizeWorkspaceRoot(workspaceRoot));
    if (id === null || id === undefined || id === '') {
      delete store.activeByWorkspace[wsKey];
    } else if (typeof id === 'string') {
      store.activeByWorkspace[wsKey] = id;
    }
    await storage.writeChatHistoryStore(store);
    return { ok: true };
  });
}

module.exports = { registerChatHistoryHandlers };
