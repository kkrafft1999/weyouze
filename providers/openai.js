const { iterSseEvents, readErrorMessage } = require('./stream-helpers');

const DEFAULT_BASE = 'https://api.openai.com/v1';

function baseUrlOf(config) {
  const raw = typeof config?.baseUrl === 'string' ? config.baseUrl.trim() : '';
  return (raw || DEFAULT_BASE).replace(/\/$/, '');
}

async function listModels(config) {
  const apiKey = config?.apiKey;
  if (!apiKey) return { error: 'API-Key fehlt.' };
  const url = `${baseUrlOf(config)}/models`;
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (err) {
    return { error: err.message || 'Netzwerkfehler' };
  }
  if (!res.ok) return { error: await readErrorMessage(res) };
  const json = await res.json().catch(() => null);
  if (!json || !Array.isArray(json.data)) {
    return { error: 'Unerwartete Antwort der OpenAI-API.' };
  }
  const models = json.data
    .map((m) => m && typeof m.id === 'string' ? { id: m.id, label: m.id } : null)
    .filter(Boolean)
    .filter((m) => !/whisper|tts|embedding|dall-e|moderation|davinci|babbage|curie|^ada/i.test(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { models };
}

function mergeToolCallDeltas(acc, deltas) {
  if (!Array.isArray(deltas)) return;
  for (const d of deltas) {
    const idx = typeof d.index === 'number' ? d.index : 0;
    if (!acc.has(idx)) {
      acc.set(idx, { id: '', type: 'function', function: { name: '', arguments: '' } });
    }
    const cur = acc.get(idx);
    if (d.id) cur.id = d.id;
    if (d.type) cur.type = d.type;
    if (d.function?.name) cur.function.name += d.function.name;
    if (typeof d.function?.arguments === 'string') {
      cur.function.arguments += d.function.arguments;
    }
  }
}

function toolCallsMapToArray(map) {
  if (map.size === 0) return undefined;
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => ({
      id: v.id,
      type: v.type || 'function',
      function: { name: v.function.name, arguments: v.function.arguments },
    }));
}

function reasoningFragmentFromDelta(delta) {
  if (!delta) return null;
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
    return delta.reasoning_content;
  }
  if (typeof delta.reasoning === 'string' && delta.reasoning.length > 0) {
    return delta.reasoning;
  }
  if (typeof delta.thinking === 'string' && delta.thinking.length > 0) {
    return delta.thinking;
  }
  return null;
}

async function streamChatRound({ config, model, messages, tools, callbacks }) {
  const apiKey = config?.apiKey;
  if (!apiKey) return { error: 'Kein API-Key hinterlegt.', code: 'NO_API_KEY' };

  const body = { model, messages, stream: true };
  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  let res;
  try {
    res = await fetch(`${baseUrlOf(config)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { error: err.message || 'Netzwerkfehler', code: 'NETWORK' };
  }

  if (!res.ok) {
    return { error: await readErrorMessage(res), code: String(res.status) };
  }
  if (!res.body) return { error: 'Keine Stream-Antwort.', code: 'STREAM' };

  const reader = res.body.getReader();
  const fullContentRef = { v: '' };
  const toolCallsByIndex = new Map();
  let finishReason = null;

  const apply = (delta) => {
    const reasoning = reasoningFragmentFromDelta(delta);
    if (reasoning) callbacks.onReasoningDelta(reasoning);
    if (delta?.content) {
      fullContentRef.v += delta.content;
      callbacks.onTextDelta(delta.content);
    }
    if (delta?.tool_calls) {
      callbacks.onMarkGenerating();
      mergeToolCallDeltas(toolCallsByIndex, delta.tool_calls);
    }
  };

  try {
    for await (const evt of iterSseEvents(reader)) {
      const data = evt.data;
      if (!data || data === '[DONE]') continue;
      let json;
      try { json = JSON.parse(data); } catch { continue; }
      const choice = json.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      apply(choice.delta);
    }
  } finally {
    reader.releaseLock?.();
  }

  const fullContent = fullContentRef.v;
  const tool_calls = toolCallsMapToArray(toolCallsByIndex);
  const message = {
    role: 'assistant',
    content: fullContent.length > 0 ? fullContent : tool_calls?.length ? null : '',
    ...(tool_calls?.length ? { tool_calls } : {}),
  };
  return { message, finishReason };
}

module.exports = {
  id: 'openai',
  name: 'OpenAI',
  fields: { apiKey: true },
  defaultModel: 'gpt-4o-mini',
  apiBase: DEFAULT_BASE,
  listModels,
  streamChatRound,
};
