const path = require('path');

let activeWorkspaceRoot = null;

function setActiveWorkspaceRoot(folderPath) {
  const raw = typeof folderPath === 'string' ? folderPath.trim() : '';
  activeWorkspaceRoot = raw ? path.resolve(raw) : null;
}

function getActiveWorkspaceRoot() {
  return activeWorkspaceRoot;
}

module.exports = {
  setActiveWorkspaceRoot,
  getActiveWorkspaceRoot,
};
