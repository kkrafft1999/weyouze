/**
 * WorkspacePath-Port: Pfadauflösung ohne Node-path im Core.
 */

/**
 * @typedef {Object} WorkspaceSelection
 * @property {string} relativePath
 * @property {boolean} isDirectory
 */

/**
 * @typedef {Object} WorkspacePathPort
 * @property {(rawRoot: unknown) => string|null} resolveRoot
 * @property {(root: string, selectedPath: unknown, selectedIsDirectory: unknown) => WorkspaceSelection|null} resolveSelection
 * @property {(absPath: string) => string} basename
 */

module.exports = {};
