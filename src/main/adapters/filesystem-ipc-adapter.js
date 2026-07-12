'use strict';

function createFilesystemIpcAdapter({ fsService, getActiveWorkspaceRoot }) {
  async function boundPath(absPath) {
    const workspaceRoot = getActiveWorkspaceRoot();
    return fsService.assertPathAccessibleInWorkspace(workspaceRoot, absPath);
  }

  return {
    async readDirectory(dirPath) {
      const { absPath, error } = await boundPath(dirPath);
      if (error) {
        console.error('readDirectory denied:', error);
        return [];
      }
      try {
        return await fsService.readDirectory(absPath);
      } catch (err) {
        console.error('readDirectory error:', err.message);
        return [];
      }
    },
    async moveItem(sourcePath, destDir) {
      const source = await boundPath(sourcePath);
      if (source.error) return { error: source.error };
      const dest = await boundPath(destDir);
      if (dest.error) return { error: dest.error };
      try {
        return await fsService.moveItem(source.absPath, dest.absPath);
      } catch (err) {
        return { error: err.message };
      }
    },
    async readFilePreview(filePath) {
      const { absPath, error } = await boundPath(filePath);
      if (error) return { error };
      try {
        return await fsService.readFilePreview(absPath);
      } catch (err) {
        return { error: err.message };
      }
    },
  };
}

module.exports = {
  createFilesystemIpcAdapter,
};
