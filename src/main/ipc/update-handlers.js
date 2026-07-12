'use strict';

function registerUpdateHandlers({ ipcMain, updates, REQ }) {
  ipcMain.handle(REQ.UPDATE_GET_VERSION, async () => ({
    version: updates.getCurrentVersion(),
  }));

  // respectIgnored=false: ein manueller Check soll auch eine zuvor
  // uebersprungene Version wieder anzeigen.
  ipcMain.handle(REQ.UPDATE_CHECK, async () =>
    updates.checkForUpdate({ respectIgnored: false }));

  ipcMain.handle(REQ.UPDATE_IGNORE_VERSION, async (_event, version) =>
    updates.ignoreVersion(version));
}

module.exports = { registerUpdateHandlers };
