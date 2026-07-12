function registerWhisperHandlers({ ipcMain, speech, uiPrefsStore, REQ }) {
  ipcMain.handle(REQ.WHISPER_TRANSCRIBE, async (_event, audioBuffer) => {
    const uiPrefs = await uiPrefsStore.readUIPrefs();
    return speech.transcribeAudio(audioBuffer, { language: uiPrefs.appLocale });
  });
}

module.exports = { registerWhisperHandlers };
