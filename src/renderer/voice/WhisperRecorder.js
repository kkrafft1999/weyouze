export function initWhisperRecorder({
  api,
  appStore,
  btnChatMic,
  chatVoiceStatus,
  chatInput,
  onInputChanged,
}) {
  function setMicUi(recording) {
    btnChatMic.classList.toggle('recording', recording);
    btnChatMic.setAttribute('aria-pressed', recording ? 'true' : 'false');
    btnChatMic.title = recording ? 'Aufnahme stoppen' : 'Spracheingabe';
    btnChatMic.setAttribute('aria-label', recording ? 'Aufnahme stoppen' : 'Spracheingabe starten');
  }

  function setVoiceStatus(text) {
    if (text) {
      chatVoiceStatus.textContent = text;
      chatVoiceStatus.classList.remove('hidden');
    } else {
      chatVoiceStatus.textContent = '';
      chatVoiceStatus.classList.add('hidden');
    }
  }

  function releaseVoiceStream() {
    if (appStore.voiceStream) {
      for (const track of appStore.voiceStream.getTracks()) track.stop();
      appStore.voiceStream = null;
    }
  }

  async function startVoiceRecording() {
    if (appStore.voiceRecording || appStore.voiceTranscribing) return;
    try {
      appStore.voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setVoiceStatus(err.name === 'NotAllowedError' ? 'Mikrofonzugriff verweigert.' : `Mikrofon: ${err.message}`);
      return;
    }

    appStore.voiceChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    appStore.voiceMediaRecorder = new MediaRecorder(appStore.voiceStream, { mimeType });
    appStore.voiceMediaRecorder.ondataavailable = (e) => {
      if (e.data?.size > 0) appStore.voiceChunks.push(e.data);
    };
    appStore.voiceMediaRecorder.onstop = () => handleVoiceStopped();
    appStore.voiceMediaRecorder.start(250);

    appStore.voiceRecording = true;
    setMicUi(true);
    setVoiceStatus('Aufnahme laeuft …');
  }

  function stopVoiceRecording() {
    if (!appStore.voiceRecording || !appStore.voiceMediaRecorder) return;
    appStore.voiceRecording = false;
    try { appStore.voiceMediaRecorder.stop(); } catch { /* already stopped */ }
    releaseVoiceStream();
  }

  async function handleVoiceStopped() {
    setMicUi(false);

    if (appStore.voiceChunks.length === 0) { setVoiceStatus(''); return; }
    const blob = new Blob(appStore.voiceChunks, { type: 'audio/webm' });
    appStore.voiceChunks = [];
    if (blob.size < 1000) { setVoiceStatus('Aufnahme zu kurz.'); return; }

    appStore.voiceTranscribing = true;
    btnChatMic.disabled = true;
    setVoiceStatus('Transkribiere…');

    try {
      const buf = await blob.arrayBuffer();
      const result = await api.transcribeAudio(buf);
      if (result.error) {
        setVoiceStatus(`Fehler: ${result.error}`);
      } else if (result.text?.trim()) {
        const cur = chatInput.value;
        const sep = cur && !/\s$/.test(cur) ? ' ' : '';
        chatInput.value = cur + sep + result.text.trim();
        onInputChanged();
        setVoiceStatus('');
        chatInput.focus();
      } else {
        setVoiceStatus('Keine Sprache erkannt.');
      }
    } catch (err) {
      setVoiceStatus(`Fehler: ${err.message || 'Transkription fehlgeschlagen.'}`);
    } finally {
      appStore.voiceTranscribing = false;
      btnChatMic.disabled = false;
    }
  }

  function stopChatVoiceListening() {
    if (appStore.voiceRecording) stopVoiceRecording();
    releaseVoiceStream();
    setMicUi(false);
    if (!appStore.voiceTranscribing) setVoiceStatus('');
  }

  btnChatMic.addEventListener('click', () => {
    if (btnChatMic.disabled) return;
    if (appStore.voiceRecording) {
      stopVoiceRecording();
    } else {
      startVoiceRecording();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopChatVoiceListening();
  });

  return { stopChatVoiceListening };
}
