export function initChatModelPicker({
  api,
  appStore,
  chatTitleEl,
  chatHint,
  btnChatSend,
  chatModelPickerWrap,
  btnChatModelPicker,
  chatModelPillLabel,
  chatModelMenu,
  chatLiveDot,
  onLlmStateChanged,
}) {
  let chatModelMenuOpen = false;

  function findProviderMeta(providerId) {
    return (appStore.llmState.providers || []).find((p) => p.id === providerId) || null;
  }

  function presetSummaryForMenu(pr) {
    const meta = findProviderMeta(pr.providerId);
    if (!meta) return '';
    const parts = [];
    if (pr.providerId === 'openai' && pr.reasoningEffort) {
      parts.push(`reasoning_effort: ${pr.reasoningEffort}`);
    }
    if (meta.fields?.baseUrl) {
      const url = (meta.baseUrl || meta.defaultBaseUrl || '').trim();
      const host = url ? url.replace(/^https?:\/\//, '') : 'Server';
      const tls = !!meta.insecureTls;
      parts.push(`Server ${host} · TLS ${tls ? 'insecure' : 'geprüft'}`);
    }
    return parts.join(' · ');
  }

  function activeProviderConfigured() {
    const pid = appStore.llmState.chatTarget?.providerId;
    const p = pid ? findProviderMeta(pid) : null;
    return !!(p && p.configured);
  }

  function closeChatModelMenu() {
    chatModelMenuOpen = false;
    if (chatModelMenu) chatModelMenu.classList.add('hidden');
    if (btnChatModelPicker) {
      btnChatModelPicker.setAttribute('aria-expanded', 'false');
    }
  }

  function rebuildChatModelMenu() {
    if (!chatModelMenu) return 0;
    chatModelMenu.innerHTML = '';
    const presets = Array.isArray(appStore.llmState.presets) ? appStore.llmState.presets : [];
    const activeId = appStore.llmState.activePresetId;
    let count = 0;
    for (const pr of presets) {
      if (pr.menuVisible === false) continue;
      const meta = findProviderMeta(pr.providerId);
      if (!meta || !meta.configured) continue;
      count += 1;
      const li = document.createElement('li');
      li.setAttribute('role', 'none');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-model-menu-option';
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', pr.id === activeId ? 'true' : 'false');
      btn.dataset.presetId = pr.id;

      const main = document.createElement('span');
      main.className = 'chat-model-menu-opt-main';

      const t = document.createElement('span');
      t.className = 'chat-model-menu-opt-title';
      t.lang = 'en';
      t.textContent = `${meta.name} · ${pr.model || meta.defaultModel}`;
      main.appendChild(t);

      const sub = document.createElement('span');
      sub.className = 'chat-model-menu-opt-meta';
      sub.textContent = presetSummaryForMenu(pr);
      main.appendChild(sub);

      btn.appendChild(main);
      li.appendChild(btn);
      chatModelMenu.appendChild(li);
    }
    return count;
  }

  async function persistActivePreset(presetId) {
    try {
      const res = await api.setActivePreset(presetId);
      if (!res?.ok) return false;
      await refreshLLMState();
      return true;
    } catch {
      return false;
    }
  }

  async function refreshLLMState() {
    appStore.llmState = await api.getLLMState();
    if (!appStore.llmState.presets) appStore.llmState.presets = [];
    const ct = appStore.llmState.chatTarget;
    if (!ct || !ct.providerId) {
      const ap = appStore.llmState.activeProvider;
      const m = findProviderMeta(ap);
      appStore.llmState.chatTarget = {
        providerId: ap,
        model: m?.model || '',
        reasoningEffort: null,
      };
    }
    updateChatChrome();
    onLlmStateChanged?.();
  }

  function syncLiveDot() {
    if (!chatLiveDot) return;
    const last = appStore.chatMessages[appStore.chatMessages.length - 1];
    const streaming = !!(last && last.role === 'assistant' && last.streaming);
    const configured = activeProviderConfigured();

    let state = 'offline';
    let label = 'Kein KI-Anbieter konfiguriert';
    if (streaming) {
      state = 'streaming';
      label = 'Modell antwortet';
    } else if (configured) {
      state = 'live';
      label = 'Verbindung aktiv';
    }
    chatLiveDot.dataset.state = state;
    chatLiveDot.setAttribute('aria-label', label);
  }

  function updateChatChrome() {
    const target = appStore.llmState.chatTarget;
    const active = target?.providerId ? findProviderMeta(target.providerId) : null;
    const isConfigured = activeProviderConfigured();

    if (chatTitleEl) {
      if (appStore.rootPath) {
        const projectName = appStore.rootPath.split('/').pop() || appStore.rootPath;
        chatTitleEl.textContent = projectName;
        chatTitleEl.removeAttribute('lang');
      } else {
        chatTitleEl.textContent = 'Chat';
        chatTitleEl.removeAttribute('lang');
      }
    }

    if (chatModelPickerWrap && btnChatModelPicker && chatModelPillLabel) {
      if (active && target?.model && isConfigured) {
        chatModelPickerWrap.classList.remove('hidden');
        btnChatModelPicker.classList.remove('hidden');
        chatModelPillLabel.textContent = `${active.name} · ${target.model}`;
      } else {
        chatModelPickerWrap.classList.add('hidden');
        btnChatModelPicker.classList.add('hidden');
        chatModelPillLabel.textContent = '';
      }
    }
    if (!chatModelMenuOpen) {
      closeChatModelMenu();
      if (chatModelMenu) chatModelMenu.innerHTML = '';
    }

    let modelHint = '';
    if (active && target?.model) {
      modelHint = `${active.name} · ${target.model}`;
    } else if (active) {
      modelHint = `${active.name}`;
    }

    if (!isConfigured) {
      if (!appStore.llmState.encryptionAvailable) {
        chatHint.textContent =
          'Verschlüsselter Speicher ist nicht verfügbar. Ein API-Key kann hier nicht sicher gespeichert werden.';
      } else {
        chatHint.textContent = 'Konfiguriere ein Sprachmodell über das Zahnrad, um zu chatten.';
      }
      chatHint.classList.remove('hidden');
      if (!appStore.chatInFlight) btnChatSend.disabled = true;
    } else if (!appStore.rootPath) {
      chatHint.textContent =
        `${modelHint ? `Aktiv: ${modelHint}` : 'Aktives Modell'} – Tipp: Öffne einen Ordner, damit der Assistent Dateien per Tool einlesen kann.`;
      chatHint.classList.remove('hidden');
      if (!appStore.chatInFlight) btnChatSend.disabled = false;
    } else {
      chatHint.classList.add('hidden');
      if (!appStore.chatInFlight) btnChatSend.disabled = false;
    }

    syncLiveDot();
  }

  function toggleChatModelDropdown() {
    if (!chatModelMenu || !btnChatModelPicker) return;
    if (!chatModelMenu.classList.contains('hidden')) {
      closeChatModelMenu();
      return;
    }
    const n = rebuildChatModelMenu();
    if (n === 0) return;
    chatModelMenuOpen = true;
    chatModelMenu.classList.remove('hidden');
    btnChatModelPicker.setAttribute('aria-expanded', 'true');
  }

  document.addEventListener('click', (e) => {
    if (chatModelMenuOpen && chatModelMenu && btnChatModelPicker) {
      const t = e.target;
      if (!t?.closest?.('.chat-model-picker-wrap')) {
        closeChatModelMenu();
      }
    }
  });

  if (btnChatModelPicker) {
    btnChatModelPicker.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleChatModelDropdown();
    });
  }

  if (chatModelMenu) {
    chatModelMenu.addEventListener('click', async (e) => {
      const opt = e.target.closest('.chat-model-menu-option');
      if (!opt) return;
      const pid = opt.dataset.presetId;
      if (!pid) return;
      closeChatModelMenu();
      await persistActivePreset(pid);
    });
  }

  return {
    findProviderMeta,
    activeProviderConfigured,
    refreshLLMState,
    updateChatChrome,
    syncLiveDot,
    closeChatModelMenu,
    presetSummaryForMenu,
  };
}
