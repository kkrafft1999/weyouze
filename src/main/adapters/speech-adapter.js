'use strict';

function createSpeechAdapter(whisperService) {
  return {
    transcribeAudio(audioBuffer, options) {
      return whisperService.transcribeAudio(audioBuffer, options);
    },
  };
}

module.exports = {
  createSpeechAdapter,
};
