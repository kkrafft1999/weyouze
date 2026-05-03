function registerWhisperHandlers({ ipcMain, whisperService, REQ }) {
  ipcMain.handle(REQ.WHISPER_TRANSCRIBE, async (_event, audioBuffer) => {
    return whisperService.transcribeAudio(audioBuffer);
  });
}

module.exports = { registerWhisperHandlers };
