export function inferChatTitle(messages) {
  const u = messages.find((m) => m.role === 'user');
  if (u && u.content) {
    const t = String(u.content).trim().replace(/\s+/g, ' ');
    if (t.length > 48) return `${t.slice(0, 47)}…`;
    return t || 'Chat';
  }
  return 'Neuer Chat';
}

export function serializeChatMessagesForStorage(messages) {
  return messages.map((m) => {
    if (m.role === 'user') {
      return { role: 'user', content: String(m.content ?? '') };
    }
    if (m.role === 'assistant') {
      const row = {
        role: 'assistant',
        content: String(m.content ?? ''),
      };
      if (m.isError) row.isError = true;
      if (Array.isArray(m.toolTrace) && m.toolTrace.length) row.toolTrace = [...m.toolTrace];
      if (m.reasoningText && String(m.reasoningText).trim()) {
        row.reasoningText = String(m.reasoningText);
      }
      return row;
    }
    return null;
  }).filter(Boolean);
}

export function normalizeLoadedMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return null;
    if (m.role === 'user') {
      return { role: 'user', content: String(m.content ?? '') };
    }
    return {
      role: 'assistant',
      content: String(m.content ?? ''),
      toolTrace: Array.isArray(m.toolTrace) ? [...m.toolTrace] : [],
      reasoningText: typeof m.reasoningText === 'string' ? m.reasoningText : '',
      streaming: false,
      isError: Boolean(m.isError),
    };
  }).filter(Boolean);
}

export function formatHistoryTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
