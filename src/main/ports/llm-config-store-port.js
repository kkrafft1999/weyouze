/**
 * Persistenz der LLM-/Provider-Konfiguration (ohne Chat-Verlauf/UI-Prefs).
 *
 * @typedef {Object} LlmConfigStorePort
 * @property {() => Promise<object>} readLLMConfig
 * @property {(config: object) => Promise<void>} [writeLLMConfig]
 * @property {(updater: (config: object) => object|Promise<object>) => Promise<object>} updateLLMConfig
 * @property {(llmConfig: object) => object} resolveChatModelTarget
 * @property {(raw: object) => object|null} normalizePresetEntry
 */

module.exports = {};
