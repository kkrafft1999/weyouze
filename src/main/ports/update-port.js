/**
 * Update-Notifier.
 *
 * @typedef {Object} UpdatePort
 * @property {() => string} getCurrentVersion
 * @property {(options?: { respectIgnored?: boolean }) => Promise<object>} checkForUpdate
 * @property {(version: string) => Promise<void>} ignoreVersion
 */

module.exports = {};
