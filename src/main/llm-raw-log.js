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

// Credential-Muster im Freitext der Stream-Antwort. Anders als Header/URL/Body
// ist der Stream Provider-Freitext ohne feste Struktur — ein Fehler-Payload
// kann den Request (inkl. Key) zurueckspiegeln. Strukturelle Redaction greift
// hier nicht, daher Best-Effort ueber die verbreiteten Key-Formate.
const SECRET_TEXT_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/g, // OpenAI / Anthropic (sk-…, sk-ant-…)
  /\bAIza[A-Za-z0-9_-]{16,}/g, // Google API-Key
];

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

// Maskiert bekannte Credential-Formate in beliebigem Freitext (Stream-Antwort).
function redactSecrets(text) {
  if (typeof text !== 'string' || !text) return text;
  let out = text;
  for (const re of SECRET_TEXT_PATTERNS) out = out.replace(re, REDACTED);
  // Bearer-Tokens: das Schema behalten, nur den Token-Teil maskieren.
  out = out.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, `$1${REDACTED}`);
  return out;
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
 * (ueber onRawLine) jede empfangene Stream-Zeile; der Chat-Core ruft am Ende
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
      const safe = redactSecrets(line);
      if (responseRaw.length + safe.length + 1 > MAX_RESPONSE_CHARS) {
        responseRaw += '\n…(gekuerzt — Stream ueberschritt das Anzeigelimit)…';
        truncated = true;
        return;
      }
      responseRaw += (responseRaw ? '\n' : '') + safe;
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
        // Lesbare, provider-unabhaengige Sicht (vom chat-handler befuellt):
        // die gesendete Konversation und die geparste Modell-Antwort.
        messages: Array.isArray(meta.messages) ? meta.messages : [],
        response: meta.response ?? null,
        // Rohdaten (provider-spezifisch) — fuer den optionalen Roh-Blick.
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
  redactSecrets,
  serializeBody,
};
