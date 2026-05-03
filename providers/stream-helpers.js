async function* iterStreamLines(reader) {
  const decoder = new TextDecoder();
  let carry = '';
  while (true) {
    const { done, value } = await reader.read();
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

async function* iterSseEvents(reader) {
  let currentEvent = null;
  let dataLines = [];
  for await (const line of iterStreamLines(reader)) {
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

module.exports = {
  iterStreamLines,
  iterSseEvents,
  readErrorMessage,
};
