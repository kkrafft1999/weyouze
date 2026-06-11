const openai = require('./openai');
const anthropic = require('./anthropic');
const google = require('./google');
const ollama = require('./ollama');
const mlxLm = require('./mlx-lm');

const PROVIDERS = { openai, anthropic, google, ollama, 'mlx-lm': mlxLm };
const PROVIDER_ORDER = ['openai', 'anthropic', 'google', 'ollama', 'mlx-lm'];

function getProvider(id) {
  return PROVIDERS[id] || null;
}

function listProviderMeta() {
  return PROVIDER_ORDER.map((id) => {
    const p = PROVIDERS[id];
    return {
      id: p.id,
      name: p.name,
      fields: p.fields || {},
      defaultModel: p.defaultModel || '',
      defaultBaseUrl: p.defaultBaseUrl || '',
      defaultInsecureTls: p.defaultInsecureTls === true,
      apiBase: p.apiBase || '',
    };
  });
}

/** Gibt Provider-Ressourcen (z. B. undici-Dispatcher) beim App-Ende frei. */
function disposeAll() {
  for (const id of PROVIDER_ORDER) {
    const p = PROVIDERS[id];
    if (typeof p?.dispose !== 'function') continue;
    try {
      p.dispose();
    } catch (err) {
      console.error(`Provider ${id} dispose failed:`, err);
    }
  }
}

module.exports = {
  PROVIDERS,
  PROVIDER_ORDER,
  getProvider,
  listProviderMeta,
  disposeAll,
};
