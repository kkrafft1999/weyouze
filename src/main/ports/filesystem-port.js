/**
 * Dateisystem-IPC mit Workspace-Sandbox (Explorer + Vorschau).
 *
 * @typedef {Object} FilesystemPort
 * @property {(dirPath: string) => Promise<Array>} readDirectory
 * @property {(sourcePath: string, destDir: string) => Promise<object>} moveItem
 * @property {(filePath: string) => Promise<object>} readFilePreview
 */

module.exports = {};
