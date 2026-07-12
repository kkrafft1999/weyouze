'use strict';

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

module.exports = {
  describeFetchError,
};
