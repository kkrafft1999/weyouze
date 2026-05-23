const SETTINGS_NAV_LABELS = { models: 'Modelle', tools: 'Tools', general: 'Allgemein' };

let settingsDraftPresets = [];
let settingsDraftActivePresetId = null;
let settingsCredentialDraft = {};

export function initSettingsModal(deps) {
  const {
    api,
    appStore,
    modalSettings,
    modalSettingsBackdrop,
    settingsPanelHeadingEl,
    settingsNavTabs,
    prefModelList,
    prefListEmpty,
    btnOpenAddModel,
    addModelOverlay,
    selectProvider,
    providerStatus,
    providerKeyRow,
    providerBaseUrlRow,
    inputApiKey,
    btnRemoveApiKey,
    inputBaseUrl,
    providerInsecureRow,
    inputInsecureTls,
    openaiReasoningSection,
    selectPopupReasoning,
    selectModel,
    btnLoadModels,
    modelLoadProviderLabel,
    modelStatus,
    btnAddPresetRow,
    btnAddModelCloseX,
    btnAddModelClose,
    btnSettingsSave,
    btnSettingsClose,
    btnSettingsFooterClose,
    inputGlobalSystemPrompt,
    selectAppLocale,
    inputMaxToolRounds,
    modalEncryptionWarning,
    modalSaveError,
    btnChatSettings,
    stopChatVoiceListening,
    closeChatModelMenu,
    refreshLLMState,
    findProviderMeta,
    updateChatChrome,
    DEFAULT_MAX_TOOL_ROUNDS = 14,
  } = deps;

  function presetDetailRowForDraft(pr) {
    const meta = findProviderMeta(pr.providerId);
    if (!meta) return '';
    const d = settingsCredentialDraft[pr.providerId] || {};
    if (pr.providerId === 'openai' && pr.reasoningEffort) {
      return `reasoning_effort: ${pr.reasoningEffort}`;
    }
    if (meta.fields?.baseUrl) {
      const url = (d.baseUrl || meta.baseUrl || meta.defaultBaseUrl || '').trim();
      const host = url ? url.replace(/^https?:\/\//, '') : 'Server';
      const tls = typeof d.insecureTls === 'boolean' ? d.insecureTls : !!meta.insecureTls;
      return `Server: ${host} · TLS ${tls ? 'insecure' : 'geprüft'}`;
    }
    return meta.apiBase || '';
  }

  function setModalError(text) {
    if (text) {
      modalSaveError.textContent = text;
      modalSaveError.classList.remove('hidden');
    } else {
      modalSaveError.textContent = '';
      modalSaveError.classList.add('hidden');
    }
  }

  function setProviderStatus(text, isError = false) {
    providerStatus.textContent = text || '';
    providerStatus.classList.toggle('error', !!isError);
  }

  function setModelStatus(text, isError = false) {
    modelStatus.textContent = text || '';
    modelStatus.classList.toggle('error', !!isError);
  }

  function hydrateCredentialDraftFromLlmState() {
    settingsCredentialDraft = {};
    for (const p of appStore.llmState.providers || []) {
      settingsCredentialDraft[p.id] = {
        apiKey: '',
        removeApiKey: false,
        baseUrl: (p.baseUrl || p.defaultBaseUrl || '').trim(),
        insecureTls: !!p.insecureTls,
      };
    }
  }

  function stashPopupCredentialInputs() {
    const id = selectProvider?.value;
    if (!id || !settingsCredentialDraft[id]) return;
    settingsCredentialDraft[id].apiKey = (inputApiKey.value || '').trim();
    if (settingsCredentialDraft[id].apiKey) {
      settingsCredentialDraft[id].removeApiKey = false;
    }
    settingsCredentialDraft[id].baseUrl = (inputBaseUrl.value || '').trim();
    settingsCredentialDraft[id].insecureTls = !!inputInsecureTls.checked;
  }

  function renderProviderSelect() {
    selectProvider.innerHTML = '';
    for (const p of appStore.llmState.providers || []) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.setAttribute('lang', 'en');
      const tags = [];
      if (p.id === appStore.llmState.activeProvider) tags.push('aktiv');
      if (p.configured) tags.push('konfiguriert');
      opt.textContent = tags.length ? `${p.name} – ${tags.join(', ')}` : p.name;
      selectProvider.appendChild(opt);
    }
    const presetFromActive = settingsDraftPresets.find((x) => x.id === settingsDraftActivePresetId);
    selectProvider.value =
      presetFromActive?.providerId ||
      appStore.llmState.chatTarget?.providerId ||
      appStore.llmState.activeProvider;
  }

  function renderModelSelect(currentValue, options) {
    selectModel.innerHTML = '';
    const seen = new Set();
    const add = (id, label) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      const opt = document.createElement('option');
      opt.value = id;
      opt.setAttribute('lang', 'en');
      opt.textContent = label || id;
      selectModel.appendChild(opt);
    };
    if (Array.isArray(options)) {
      for (const m of options) add(m.id, m.label || m.id);
    }
    if (currentValue) add(currentValue, currentValue);
    if (selectModel.children.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '— noch keine Modelle geladen —';
      opt.disabled = true;
      selectModel.appendChild(opt);
    } else if (currentValue) {
      selectModel.value = currentValue;
    }
  }

  function syncPopupProviderUI(providerId, skipStash) {
    const meta = findProviderMeta(providerId);
    if (!meta) return;
    if (!skipStash) stashPopupCredentialInputs();

    selectProvider.value = providerId;

    if (!settingsCredentialDraft[providerId]) {
      settingsCredentialDraft[providerId] = {
        apiKey: '',
        removeApiKey: false,
        baseUrl: (meta.baseUrl || meta.defaultBaseUrl || '').trim(),
        insecureTls: !!meta.insecureTls,
      };
    }
    const draft = settingsCredentialDraft[providerId];

    if (meta.fields?.apiKey) {
      providerKeyRow.classList.remove('hidden');
      inputApiKey.value = draft.apiKey || '';
      if (draft.removeApiKey && meta.hasKey) {
        inputApiKey.placeholder = 'Key wird beim Speichern entfernt';
      } else if (meta.hasKey) {
        inputApiKey.placeholder = 'Gespeicherter Key bleibt erhalten';
      } else if (meta.id === 'openai') {
        inputApiKey.placeholder = 'sk-…';
      } else if (meta.id === 'anthropic') {
        inputApiKey.placeholder = 'sk-ant-…';
      } else if (meta.id === 'google') {
        inputApiKey.placeholder = 'AIza…';
      } else {
        inputApiKey.placeholder = '••••••';
      }
      const showTrash =
        meta.hasKey || !!(draft.apiKey || '').trim() || draft.removeApiKey;
      btnRemoveApiKey?.classList.toggle('hidden', !showTrash);
    } else {
      providerKeyRow.classList.add('hidden');
      inputApiKey.value = '';
      btnRemoveApiKey?.classList.add('hidden');
    }

    if (meta.fields?.baseUrl) {
      providerBaseUrlRow.classList.remove('hidden');
      inputBaseUrl.value = draft.baseUrl || meta.baseUrl || meta.defaultBaseUrl || '';
      inputBaseUrl.placeholder = meta.defaultBaseUrl || 'http://localhost:11434';
    } else {
      providerBaseUrlRow.classList.add('hidden');
      inputBaseUrl.value = '';
    }

    if (meta.fields?.insecureTls) {
      providerInsecureRow.classList.remove('hidden');
      inputInsecureTls.checked = !!draft.insecureTls;
    } else {
      providerInsecureRow.classList.add('hidden');
      inputInsecureTls.checked = false;
    }

    if (providerId === 'openai') {
      openaiReasoningSection.classList.remove('hidden');
    } else {
      openaiReasoningSection.classList.add('hidden');
    }

    if (modelLoadProviderLabel) {
      modelLoadProviderLabel.textContent = meta.name;
    }

    renderModelSelect(meta.model || meta.defaultModel || '', null);

    const lines = [];
    if (meta.apiBase) lines.push(`API: ${meta.apiBase}`);
    if (meta.id === appStore.llmState.activeProvider) lines.push('Aktueller Chat-Anbieter');
    if (meta.fields?.apiKey) {
      if (draft.removeApiKey && meta.hasKey) {
        lines.push('Key wird beim Speichern entfernt');
      } else if (meta.hasKey && !draft.apiKey) {
        lines.push('Key gespeichert');
      } else if (draft.apiKey) {
        lines.push('Neuer Key wird beim Speichern gesetzt');
      }
    } else if (meta.configured) {
      lines.push('Konfiguriert');
    }
    setProviderStatus(lines.join(' · '), false);
    setModelStatus('');
    setModalError('');
  }

  function renderDraftPresetList() {
    if (!prefModelList) return;
    prefModelList.innerHTML = '';
    const empty = settingsDraftPresets.length === 0;
    prefListEmpty.classList.toggle('hidden', !empty);
    const trashSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

    for (const pr of settingsDraftPresets) {
      const meta = findProviderMeta(pr.providerId);
      if (!meta) continue;
      const li = document.createElement('li');

      const row = document.createElement('div');
      row.className = 'settings-pref-row-inner';
      row.dataset.presetId = pr.id;
      if (pr.menuVisible === false) row.setAttribute('data-pref-menu-off', 'true');
      else row.removeAttribute('data-pref-menu-off');

      const main = document.createElement('div');
      main.className = 'settings-pref-main';
      const title = document.createElement('strong');
      title.lang = 'en';
      title.textContent = `${meta.name} · ${pr.model || meta.defaultModel}`;
      const detail = document.createElement('span');
      detail.className = pr.providerId === 'openai' && pr.reasoningEffort ? 'settings-pref-detail settings-pref-detail--mono' : 'settings-pref-detail';
      detail.textContent = presetDetailRowForDraft(pr);
      main.appendChild(title);
      main.appendChild(detail);

      const actions = document.createElement('div');
      actions.className = 'settings-pref-actions';

      const sw = document.createElement('button');
      sw.type = 'button';
      sw.className = 'settings-pref-switch';
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', pr.menuVisible !== false ? 'true' : 'false');
      sw.setAttribute(
        'aria-label',
        `${meta.name} · ${pr.model} — ${pr.menuVisible !== false ? 'im Chat-Modellmenü sichtbar' : 'im Chat ausgeblendet'}`
      );
      sw.dataset.presetId = pr.id;
      const track = document.createElement('span');
      track.className = 'settings-pref-switch-track';
      track.setAttribute('aria-hidden', 'true');
      const knob = document.createElement('span');
      knob.className = 'settings-pref-switch-knob';
      track.appendChild(knob);
      sw.appendChild(track);

      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'settings-icon-trash';
      rm.setAttribute(
        'aria-label',
        `${meta.name} ${pr.model} aus der Liste entfernen`
      );
      rm.dataset.presetId = pr.id;
      rm.innerHTML = trashSvg;

      actions.appendChild(sw);
      actions.appendChild(rm);
      row.appendChild(main);
      row.appendChild(actions);
      li.appendChild(row);
      prefModelList.appendChild(li);
    }
  }

  function activateSettingsPanel(panelKey) {
    document.querySelectorAll('.settings-panel').forEach((p) => {
      const on = p.id === `panel-settings-${panelKey}`;
      p.classList.toggle('settings-panel--active', on);
      p.hidden = !on;
      p.toggleAttribute('hidden', !on);
    });
    settingsNavTabs.forEach((tab) => {
      const on = tab.dataset.settingsPanel === panelKey;
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
    });
    settingsPanelHeadingEl.textContent =
      SETTINGS_NAV_LABELS[panelKey] || SETTINGS_NAV_LABELS.models;
  }

  function setupDraftFromServerState() {
    const raw = appStore.llmState.presets || [];
    try {
      settingsDraftPresets = structuredClone(raw);
    } catch {
      settingsDraftPresets = JSON.parse(JSON.stringify(raw));
    }
    settingsDraftActivePresetId =
      appStore.llmState.activePresetId || settingsDraftPresets[0]?.id || null;
    hydrateCredentialDraftFromLlmState();
  }

  function applyShellLocale(lc) {
    document.documentElement.lang = lc === 'en' ? 'en' : 'de';
  }

  function getFocusableInSettingsModal() {
    if (addModelOverlay && !addModelOverlay.classList.contains('hidden')) {
      const nested = addModelOverlay.querySelector('.add-model-dialog');
      if (!nested) return [];
      return [...nested.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )].filter((el) => el.offsetParent !== null);
    }
    const dlg = modalSettings.querySelector('.modal-dialog.settings-dialog');
    if (!dlg) return [];
    return [...dlg.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((el) => {
      const inOverlay = !!el.closest('.add-model-overlay');
      return !inOverlay && el.offsetParent !== null;
    });
  }

  function handleModalKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (addModelOverlay && !addModelOverlay.classList.contains('hidden')) {
        closeAddModelOverlay();
        return;
      }
      closeSettingsModal();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = getFocusableInSettingsModal();
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function openAddModelOverlay() {
    stashPopupCredentialInputs();
    addModelOverlay.classList.remove('hidden');
    addModelOverlay.setAttribute('aria-hidden', 'false');
    renderProviderSelect();
    const pid = selectProvider.value;
    syncPopupProviderUI(pid, true);
  }

  function closeAddModelOverlay() {
    stashPopupCredentialInputs();
    addModelOverlay.classList.add('hidden');
    addModelOverlay.setAttribute('aria-hidden', 'true');
    btnOpenAddModel?.focus?.();
  }

  async function openSettingsModal() {
    stopChatVoiceListening();
    setModalError('');
    setProviderStatus('');
    setModelStatus('');
    btnSettingsSave.disabled = true;
    closeChatModelMenu(false);
    appStore.lastFocusBeforeModal = document.activeElement;
    modalSettings.classList.remove('hidden');
    modalSettings.setAttribute('aria-hidden', 'false');
    modalSettings.addEventListener('keydown', handleModalKeydown);
    try {
      await refreshLLMState();
      setupDraftFromServerState();
    } catch (err) {
      setModalError(`Einstellungen konnten nicht geladen werden: ${err.message || 'Unbekannter Fehler'}`);
      modalEncryptionWarning.classList.add('hidden');
      return;
    } finally {
      btnSettingsSave.disabled = false;
    }
    modalEncryptionWarning.classList.toggle('hidden', appStore.llmState.encryptionAvailable);
    activateSettingsPanel('models');
    try {
      const up = await api.getUIPrefs();
      inputGlobalSystemPrompt.value = typeof up.baseSystemPrompt === 'string' ? up.baseSystemPrompt : '';
      selectAppLocale.value = up.appLocale === 'en' ? 'en' : 'de';
      const mtr =
        typeof up.maxToolRounds === 'number' && Number.isFinite(up.maxToolRounds)
          ? up.maxToolRounds
          : DEFAULT_MAX_TOOL_ROUNDS;
      if (inputMaxToolRounds) inputMaxToolRounds.value = String(mtr);
    } catch {
      inputGlobalSystemPrompt.value = '';
      selectAppLocale.value = 'de';
      if (inputMaxToolRounds) inputMaxToolRounds.value = String(DEFAULT_MAX_TOOL_ROUNDS);
    }
    renderDraftPresetList();
    renderProviderSelect();
    syncPopupProviderUI(selectProvider.value, true);

    queueMicrotask(() => {
      try {
        settingsNavTabs[0]?.focus();
      } catch {
        const fb = getFocusableInSettingsModal();
        fb[0]?.focus();
      }
    });
  }

  function closeSettingsModal() {
    closeChatModelMenu(false);
    stashPopupCredentialInputs();
    closeAddModelOverlay();
    modalSettings.classList.add('hidden');
    modalSettings.setAttribute('aria-hidden', 'true');
    modalSettings.removeEventListener('keydown', handleModalKeydown);
    if (appStore.lastFocusBeforeModal && typeof appStore.lastFocusBeforeModal.focus === 'function') {
      try { appStore.lastFocusBeforeModal.focus(); } catch { /* ignore */ }
    }
    appStore.lastFocusBeforeModal = null;
  }

  async function loadModelsForPopup() {
    const providerId = selectProvider.value;
    const meta = findProviderMeta(providerId);
    if (!meta) return;
    stashPopupCredentialInputs();

    const d = settingsCredentialDraft[providerId] || {};
    const apiKey = d.apiKey;
    const baseUrl = (d.baseUrl || '').trim();
    const insecureTls = meta.fields?.insecureTls ? !!d.insecureTls : undefined;

    if (meta.fields?.apiKey && !apiKey && (!meta.hasKey || d.removeApiKey)) {
      setModelStatus('Bitte zuerst einen API-Key eingeben.', true);
      return;
    }
    if (meta.fields?.baseUrl && !baseUrl && !meta.baseUrl) {
      setModelStatus('Bitte eine Server-URL angeben.', true);
      return;
    }

    btnLoadModels.disabled = true;
    setModelStatus('Lade Modelle …');
    try {
      const result = await api.listModels({
        providerId,
        apiKey: apiKey || undefined,
        baseUrl: baseUrl || undefined,
        insecureTls,
      });
      if (result?.error) {
        setModelStatus(`Fehler: ${result.error}`, true);
        return;
      }
      const models = Array.isArray(result?.models) ? result.models : [];
      if (models.length === 0) {
        setModelStatus('Keine Modelle gefunden.', true);
        renderModelSelect(meta.model || meta.defaultModel || '', null);
        return;
      }
      const current = selectModel.value || meta.model || meta.defaultModel || models[0].id;
      renderModelSelect(current, models);
      if ([...selectModel.options].some((o) => o.value === current)) {
        selectModel.value = current;
      } else {
        selectModel.value = models[0].id;
      }
      setModelStatus(`${models.length} Modelle gefunden.`, false);
    } catch (err) {
      setModelStatus(`Fehler: ${err.message || 'Modelle konnten nicht geladen werden.'}`, true);
    } finally {
      btnLoadModels.disabled = false;
    }
  }

  function addPresetDraftFromPopup() {
    stashPopupCredentialInputs();
    const pv = selectProvider.value;
    const meta = findProviderMeta(pv);
    if (!meta) return false;
    const model = (selectModel.value || '').trim() || meta.defaultModel || '';
    const reasoning =
      pv === 'openai' && selectPopupReasoning ? selectPopupReasoning.value : null;

    const dup = settingsDraftPresets.some(
      (row) =>
        row.providerId === pv &&
        row.model === model &&
        (pv !== 'openai' || row.reasoningEffort === reasoning)
    );
    if (dup) {
      setModalError('Diese Kombination gibt es bereits in der Liste.');
      return false;
    }
    setModalError('');
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `p-${Date.now()}`;
    settingsDraftPresets.push({
      id,
      providerId: pv,
      model,
      reasoningEffort: reasoning,
      menuVisible: true,
    });
    if (!settingsDraftActivePresetId) settingsDraftActivePresetId = id;
    renderDraftPresetList();
    return true;
  }

  async function commitSettingsFromModal() {
    stashPopupCredentialInputs();
    setModalError('');
    if (settingsDraftPresets.length === 0) {
      setModalError('Die Präferenzliste darf nicht leer sein.');
      return;
    }
    let activePresetId = settingsDraftActivePresetId || settingsDraftPresets[0].id;
    if (!settingsDraftPresets.some((p) => p.id === activePresetId)) {
      activePresetId = settingsDraftPresets[0].id;
    }

    const providerPatches = {};
    const ids = new Set(settingsDraftPresets.map((p) => p.providerId));
    for (const pid of ids) {
      const d = settingsCredentialDraft[pid];
      const meta = findProviderMeta(pid);
      if (!meta || !d) continue;
      const patch = {};
      if (d.removeApiKey) patch.removeApiKey = true;
      if (typeof d.apiKey === 'string' && d.apiKey.trim()) patch.apiKey = d.apiKey.trim();
      const bu = typeof d.baseUrl === 'string' ? d.baseUrl.trim() : '';
      if (bu && meta.fields?.baseUrl) patch.baseUrl = bu;
      if (meta.fields?.insecureTls) patch.insecureTls = !!d.insecureTls;
      providerPatches[pid] = patch;
    }

    btnSettingsSave.disabled = true;
    try {
      const res = await api.commitSettings({
        presets: settingsDraftPresets,
        activePresetId,
        providerPatches,
        uiPrefs: {
          baseSystemPrompt: inputGlobalSystemPrompt.value || '',
          appLocale: selectAppLocale.value === 'en' ? 'en' : 'de',
          maxToolRounds: (() => {
            const n = parseInt(inputMaxToolRounds?.value || '', 10);
            return Number.isFinite(n) ? n : DEFAULT_MAX_TOOL_ROUNDS;
          })(),
        },
      });
      if (!res?.ok) {
        setModalError(res?.error || 'Speichern fehlgeschlagen.');
        return;
      }
      applyShellLocale(selectAppLocale.value === 'en' ? 'en' : 'de');
      await refreshLLMState();
      closeSettingsModal();
    } finally {
      btnSettingsSave.disabled = false;
    }
  }

  modalSettingsBackdrop.addEventListener('click', closeSettingsModal);
  btnSettingsClose.addEventListener('click', closeSettingsModal);
  btnSettingsFooterClose?.addEventListener('click', closeSettingsModal);

  settingsNavTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const key = tab.dataset.settingsPanel;
      if (key) activateSettingsPanel(key);
    });
  });

  btnOpenAddModel?.addEventListener('click', () => {
    openAddModelOverlay();
    queueMicrotask(() => {
      try {
        selectProvider.focus();
      } catch { /* ignore */ }
    });
  });

  btnAddModelCloseX?.addEventListener('click', closeAddModelOverlay);
  btnAddModelClose?.addEventListener('click', closeAddModelOverlay);

  addModelOverlay?.addEventListener('click', (e) => {
    if (e.target === addModelOverlay) closeAddModelOverlay();
  });

  selectProvider.addEventListener('change', () => {
    syncPopupProviderUI(selectProvider.value);
  });

  inputApiKey.addEventListener('input', () => {
    const id = selectProvider.value;
    if (id && settingsCredentialDraft[id]) {
      settingsCredentialDraft[id].apiKey = inputApiKey.value;
      if (inputApiKey.value.trim()) {
        settingsCredentialDraft[id].removeApiKey = false;
      }
      syncPopupProviderUI(id, true);
    }
  });

  btnRemoveApiKey?.addEventListener('click', () => {
    const id = selectProvider.value;
    if (!id || !settingsCredentialDraft[id]) return;
    settingsCredentialDraft[id].apiKey = '';
    settingsCredentialDraft[id].removeApiKey = true;
    syncPopupProviderUI(id, true);
  });

  inputBaseUrl.addEventListener('input', () => {
    const id = selectProvider.value;
    if (id && settingsCredentialDraft[id]) {
      settingsCredentialDraft[id].baseUrl = inputBaseUrl.value;
      renderDraftPresetList();
    }
  });

  inputInsecureTls.addEventListener('change', () => {
    const id = selectProvider.value;
    if (id && settingsCredentialDraft[id]) {
      settingsCredentialDraft[id].insecureTls = !!inputInsecureTls.checked;
      renderDraftPresetList();
    }
  });

  btnLoadModels.addEventListener('click', () => {
    loadModelsForPopup();
  });

  btnAddPresetRow?.addEventListener('click', () => {
    if (addPresetDraftFromPopup()) {
      closeAddModelOverlay();
    }
  });

  btnSettingsSave.addEventListener('click', () => {
    commitSettingsFromModal();
  });

  prefModelList?.addEventListener('click', (e) => {
    const sw = e.target.closest('.settings-pref-switch');
    if (sw && prefModelList.contains(sw)) {
      const id = sw.dataset.presetId;
      const row = settingsDraftPresets.find((p) => p.id === id);
      if (!row) return;
      row.menuVisible = !(row.menuVisible !== false);
      renderDraftPresetList();
      return;
    }
    const rm = e.target.closest('.settings-icon-trash');
    if (rm && prefModelList.contains(rm)) {
      const id = rm.dataset.presetId;
      settingsDraftPresets = settingsDraftPresets.filter((p) => p.id !== id);
      if (settingsDraftActivePresetId === id) {
        settingsDraftActivePresetId = settingsDraftPresets[0]?.id || null;
      }
      renderDraftPresetList();
    }
  });

  btnChatSettings.addEventListener('click', openSettingsModal);

  return { openSettingsModal, closeSettingsModal, applyShellLocale };
}
