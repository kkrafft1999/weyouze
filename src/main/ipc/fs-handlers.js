function registerFsHandlers({ ipcMain, fsService, REQ }) {
  ipcMain.handle(REQ.FS_READ_DIRECTORY, async (_event, dirPath) => {
    try {
      return await fsService.readDirectory(dirPath);
    } catch (err) {
      console.error('readDirectory error:', err.message);
      return [];
    }
  });

  ipcMain.handle(REQ.FS_MOVE_ITEM, async (_event, sourcePath, destDir) => {
    try {
      return await fsService.moveItem(sourcePath, destDir);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle(REQ.FS_READ_FILE, async (_event, filePath) => {
    try {
      return await fsService.readFilePreview(filePath);
    } catch (err) {
      return { error: err.message };
    }
  });
}

module.exports = { registerFsHandlers };
