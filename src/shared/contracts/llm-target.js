/**
 * Chat-Modell-Ziel (provider-unabhängiger Contract).
 *
 * providerOptions enthält provider-spezifische Preset-Optionen (z. B.
 * reasoningEffort). Der Anwendungs-Core behandelt das Objekt als opaque;
 * der LLM-Adapter interpretiert und merged es in die Provider-Konfiguration.
 */
'use strict';

/**
 * @typedef {Record<string, unknown>} ProviderOptions
 */

/**
 * @typedef {Object} ChatModelTarget
 * @property {string} providerId
 * @property {string} model
 * @property {ProviderOptions} [providerOptions]
 */

/**
 * @param {{ providerId: string, model: string, providerOptions?: ProviderOptions }} params
 * @returns {ChatModelTarget}
 */
function createChatModelTarget({ providerId, model, providerOptions }) {
  const out = {
    providerId: String(providerId ?? ''),
    model: String(model ?? ''),
  };
  if (providerOptions && typeof providerOptions === 'object' && Object.keys(providerOptions).length > 0) {
    out.providerOptions = { ...providerOptions };
  }
  return out;
}

module.exports = {
  createChatModelTarget,
};
