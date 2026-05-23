function registerWhisperHandlers({ ipcMain, whisperService, storage, REQ }) {
  ipcMain.handle(REQ.WHISPER_TRANSCRIBE, async (_event, audioBuffer) => {
    const uiPrefs = await storage.readUIPrefs();
    return whisperService.transcribeAudio(audioBuffer, { language: uiPrefs.appLocale });
  });
}

module.exports = { registerWhisperHandlers };
