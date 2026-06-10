async function* iterStreamLines(reader, abortSignal) {
  const decoder = new TextDecoder();
  let carry = '';
  while (true) {
    abortIfRequested(abortSignal);
    let done;
    let value;
    try {
      ({ done, value } = await reader.read());
    } catch (err) {
      if (isAbortError(err)) throw err;
      throw err;
    }
    if (done) break;
    carry += decoder.decode(value, { stream: true });
    const lines = carry.split('\n');
    carry = lines.pop() ?? '';
    for (const raw of lines) {
      yield raw.replace(/\r$/, '');
    }
  }
  if (carry) yield carry.replace(/\r$/, '');
}

async function* iterSseEvents(reader, abortSignal) {
  let currentEvent = null;
  let dataLines = [];
  for await (const line of iterStreamLines(reader, abortSignal)) {
    if (line === '') {
      if (dataLines.length > 0) {
        yield { event: currentEvent, data: dataLines.join('\n') };
      }
      currentEvent = null;
      dataLines = [];
      continue;
    }
    if (line.startsWith(':')) continue; // SSE comment
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (dataLines.length > 0) {
    yield { event: currentEvent, data: dataLines.join('\n') };
  }
}

// Reichert fetch-Fehler um die undici-cause (ECONNREFUSED, ENOTFOUND, …) an,
// damit lokale Verbindungsprobleme (Ollama, MLX-LM) diagnostizierbar bleiben.
function describeFetchError(err, baseUrl) {
  const cause = err?.cause;
  const causeCode = cause?.code || cause?.errno;
  const causeMsg = cause?.message;
  const main = err?.message || `Verbindung zu ${baseUrl} fehlgeschlagen.`;
  if (causeCode || causeMsg) {
    return `${main} (${[causeCode, causeMsg].filter(Boolean).join(': ')})`;
  }
  return main;
}

async function readErrorMessage(res) {
  const errText = await res.text().catch(() => '');
  let msg = res.statusText || `HTTP ${res.status}`;
  try {
    const j = JSON.parse(errText);
    msg = j.error?.message || j.error?.code || j.error || j.message || msg;
    if (typeof msg !== 'string') msg = String(msg);
  } catch {
    if (errText) msg = errText.slice(0, 300);
  }
  return msg;
}

function safeJsonParse(s, fallback = {}) {
  if (typeof s !== 'string' || !s.trim()) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function isAbortError(err) {
  return err?.name === 'AbortError' || err?.code === 'ABORT_ERR';
}

function createChatAbortError(message = 'Chat abgebrochen.') {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function bindAbortSignalToReader(reader, abortSignal) {
  if (!abortSignal || !reader) return () => {};
  const cancelReader = () => {
    if (typeof reader.cancel === 'function') {
      reader.cancel('Chat abgebrochen.').catch(() => {});
    }
  };
  if (abortSignal.aborted) {
    cancelReader();
    return () => {};
  }
  abortSignal.addEventListener('abort', cancelReader, { once: true });
  return () => abortSignal.removeEventListener('abort', cancelReader);
}

function abortIfRequested(abortSignal) {
  if (!abortSignal?.aborted) return;
  const reason = abortSignal.reason;
  if (reason instanceof Error) throw reason;
  const err = new Error('Aborted');
  err.name = 'AbortError';
  throw err;
}

function cancelledChatRound(message) {
  return { cancelled: true, message };
}

function createEmptyUsage() {
  return { prompt: 0, completion: 0, total: 0 };
}

function toUsageNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/** Normalizes provider-specific usage payloads to { prompt, completion, total }. */
function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const prompt = toUsageNumber(
    raw.prompt
    ?? raw.input
    ?? raw.input_tokens
    ?? raw.prompt_tokens
    ?? raw.promptTokenCount
    ?? raw.prompt_eval_count
  );
  const completion = toUsageNumber(
    raw.completion
    ?? raw.output
    ?? raw.output_tokens
    ?? raw.completion_tokens
    ?? raw.candidatesTokenCount
    ?? raw.eval_count
  );
  let total = toUsageNumber(raw.total ?? raw.total_tokens ?? raw.totalTokenCount);
  if (total === 0 && (prompt > 0 || completion > 0)) {
    total = prompt + completion;
  }
  if (prompt === 0 && completion === 0 && total === 0) return null;
  return { prompt, completion, total };
}

function mergeUsage(base, addition) {
  const next = normalizeUsage(addition);
  if (!next) return base ? { ...base } : null;
  if (!base) return next;
  const prompt = base.prompt + next.prompt;
  const completion = base.completion + next.completion;
  const total = base.total + (next.total > 0 ? next.total : next.prompt + next.completion);
  return { prompt, completion, total };
}

async function sleepAbortable(ms, abortSignal) {
  abortIfRequested(abortSignal);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      const reason = abortSignal?.reason;
      if (reason instanceof Error) {
        reject(reason);
        return;
      }
      const err = new Error('Aborted');
      err.name = 'AbortError';
      reject(err);
    };
    const cleanup = () => {
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onAbort);
    };
    abortSignal?.addEventListener('abort', onAbort, { once: true });
  });
}

module.exports = {
  iterStreamLines,
  iterSseEvents,
  describeFetchError,
  readErrorMessage,
  safeJsonParse,
  isAbortError,
  createChatAbortError,
  bindAbortSignalToReader,
  abortIfRequested,
  cancelledChatRound,
  createEmptyUsage,
  normalizeUsage,
  mergeUsage,
  sleepAbortable,
};
