function registerDialogHandlers({ ipcMain, dialog, getMainWindow, REQ }) {
  ipcMain.handle(REQ.DIALOG_OPEN_FOLDER, async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Ordner auswählen',
      buttonLabel: 'Ordner öffnen',
      message: 'Wähle einen Ordner aus, der angezeigt werden soll',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });
}

module.exports = { registerDialogHandlers };
