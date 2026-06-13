/**
 * Erfasst pro LLM-Runde den rohen Request (URL, Header, Body) und die rohe
 * Stream-Antwort, damit der Renderer sie im RAW-Protokoll anzeigen kann.
 *
 * Secrets (API-Keys in Headern und in der URL-Query) werden maskiert, bevor
 * irgendetwas gespeichert oder an den Renderer zurueckgegeben wird — das
 * Protokoll soll auch in Screenshots/Logs gefahrlos teilbar sein.
 */

const REDACTED = '***redigiert***';

// Header-Namen (lowercased), deren Wert maskiert wird.
const SECRET_HEADER_KEYS = new Set([
  'authorization',
  'x-api-key',
  'x-goog-api-key',
  'api-key',
  'cookie',
]);

// URL-Query-Parameter (lowercased), deren Wert maskiert wird.
const SECRET_QUERY_KEYS = new Set(['key', 'api_key', 'apikey', 'access_token', 'token']);

// Body-Felder (lowercased), deren Wert maskiert wird, falls ein Provider sie
// doch in den Body legt.
const SECRET_BODY_KEYS = new Set(['apikey', 'api_key', 'key', 'authorization', 'access_token']);

// Obergrenze fuer die rohe Antwort pro Runde, damit lange Streams den
// Renderer-Speicher nicht unbegrenzt fluten.
const MAX_RESPONSE_CHARS = 2_000_000;

function redactHeaders(headers) {
  const out = {};
  if (!headers || typeof headers !== 'object') return out;
  for (const [k, v] of Object.entries(headers)) {
    out[k] = SECRET_HEADER_KEYS.has(String(k).toLowerCase()) ? REDACTED : v;
  }
  return out;
}

function redactUrl(url) {
  if (typeof url !== 'string') return url;
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()]) {
      if (SECRET_QUERY_KEYS.has(key.toLowerCase())) u.searchParams.set(key, REDACTED);
    }
    return u.toString();
  } catch {
    return url;
  }
}

function redactBodyValue(value) {
  if (Array.isArray(value)) return value.map(redactBodyValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_BODY_KEYS.has(String(k).toLowerCase()) ? REDACTED : redactBodyValue(v);
    }
    return out;
  }
  return value;
}

// Liefert den Body als huebsch formatierten JSON-String (oder rohen String,
// falls kein JSON-Objekt uebergeben wurde).
function serializeBody(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(redactBodyValue(body), null, 2);
  } catch {
    return String(body);
  }
}

/**
 * Recorder fuer genau eine LLM-Runde. Der Provider meldet seinen Request und
 * (ueber onRawLine) jede empfangene Stream-Zeile; chat-handlers ruft am Ende
 * toExchange() mit Metadaten auf.
 */
function createRoundRecorder() {
  let request = null;
  let responseRaw = '';
  let truncated = false;

  return {
    /** Vom Provider unmittelbar vor dem fetch aufzurufen. */
    request({ url, method, headers, body } = {}) {
      request = {
        url: redactUrl(url),
        method: method || 'POST',
        headers: redactHeaders(headers),
        body: serializeBody(body),
      };
    },
    /** Vom Stream-Iterator pro roher Zeile aufzurufen. */
    onRawLine(line) {
      if (typeof line !== 'string') return;
      if (truncated) return;
      if (responseRaw.length + line.length + 1 > MAX_RESPONSE_CHARS) {
        responseRaw += '\n…(gekuerzt — Stream ueberschritt das Anzeigelimit)…';
        truncated = true;
        return;
      }
      responseRaw += (responseRaw ? '\n' : '') + line;
    },
    /** Baut den fertigen Protokolleintrag inkl. uebergebener Metadaten. */
    toExchange(meta = {}) {
      return {
        providerId: meta.providerId ?? null,
        model: meta.model ?? null,
        round: typeof meta.round === 'number' ? meta.round : null,
        ts: typeof meta.ts === 'number' ? meta.ts : Date.now(),
        finishReason: meta.finishReason ?? null,
        cancelled: !!meta.cancelled,
        error: meta.error ?? null,
        usage: meta.usage ?? null,
        request,
        responseRaw,
      };
    },
  };
}

module.exports = {
  createRoundRecorder,
  redactHeaders,
  redactUrl,
  serializeBody,
};
