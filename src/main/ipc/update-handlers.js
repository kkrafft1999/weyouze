'use strict';

function registerUpdateHandlers({ ipcMain, updateService, REQ }) {
  ipcMain.handle(REQ.UPDATE_GET_VERSION, async () => ({
    version: updateService.getCurrentVersion(),
  }));

  // respectIgnored=false: ein manueller Check soll auch eine zuvor
  // uebersprungene Version wieder anzeigen.
  ipcMain.handle(REQ.UPDATE_CHECK, async () =>
    updateService.checkForUpdate({ respectIgnored: false }));

  ipcMain.handle(REQ.UPDATE_IGNORE_VERSION, async (_event, version) =>
    updateService.ignoreVersion(version));
}

module.exports = { registerUpdateHandlers };
