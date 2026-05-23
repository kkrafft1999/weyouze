import { appStore } from './state/store.js';
import { initTheme } from './components/ThemeManager.js';
import { initSidebarResizer } from './components/SidebarResizer.js';
import { initFileTree } from './components/FileTree.js';
import { initWhisperRecorder } from './voice/WhisperRecorder.js';
import { initChatModelPicker } from './components/ChatModelPicker.js';
import { initChatStream } from './components/ChatStream.js';
import { initChatHistoryDrawer } from './components/ChatHistoryDrawer.js';
import { initSettingsModal } from './components/SettingsModal.js';

const api = window.electronAPI;
const DEFAULT_MAX_TOOL_ROUNDS = 14;

const themeToggle = document.getElementById('theme-toggle');
const iconSun = document.getElementById('icon-sun');
const iconMoon = document.getElementById('icon-moon');

const btnOpen = document.getElementById('btn-open-folder');
const projectName = document.getElementById('project-name');
const treeContainer = document.getElementById('tree-container');
const welcomeEl = document.getElementById('welcome');
const filePreview = document.getElementById('file-preview');
const fileInfo = document.getElementById('file-info');
const previewFilename = document.getElementById('preview-filename');
const previewMeta = document.getElementById('preview-meta');
const previewContent = document.getElementById('preview-content');
const infoFilename = document.getElementById('info-filename');
const infoSize = document.getElementById('info-size');
const infoModified = document.getElementById('info-modified');
const infoType = document.getElementById('info-type');
const sidebar = document.getElementById('sidebar');
const divider = document.getElementById('divider');
const workspace = document.getElementById('workspace');
const btnToggleContentPane = document.getElementById('btn-toggle-content-pane');
const iconContentPaneVisible = document.getElementById('icon-content-pane-visible');
const iconContentPaneHidden = document.getElementById('icon-content-pane-hidden');
const chatPanel = document.getElementById('chat-panel');
const chatDivider = document.getElementById('chat-divider');
const chatMessagesEl = document.getElementById('chat-messages');
const chatHint = document.getElementById('chat-hint');
const chatInput = document.getElementById('chat-input');
const btnChatMic = document.getElementById('btn-chat-mic');
const chatVoiceStatus = document.getElementById('chat-voice-status');
const btnChatSend = document.getElementById('btn-chat-send');
const btnChatHistory = document.getElementById('btn-chat-history');
const btnChatNew = document.getElementById('btn-chat-new');
const btnChatSettings = document.getElementById('btn-chat-settings');
const chatInputRow = document.getElementById('chat-input-row');
const chatTokenUsageEl = document.getElementById('chat-token-usage');
const chatHistoryDrawer = document.getElementById('chat-history-drawer');
const chatHistoryList = document.getElementById('chat-history-list');
const chatHistoryEmpty = document.getElementById('chat-history-empty');
const chatTitleEl = document.getElementById('chat-title');
const chatModelPickerWrap = document.getElementById('chat-model-picker-wrap');
const btnChatModelPicker = document.getElementById('btn-chat-model-picker');
const chatModelPillLabel = document.getElementById('chat-model-pill-label');
const chatModelMenu = document.getElementById('chat-model-menu');
const chatLiveDot = document.getElementById('chat-live-dot');
const modalSettings = document.getElementById('modal-settings');
const modalSettingsBackdrop = document.getElementById('modal-settings-backdrop');
const settingsPanelHeadingEl = document.getElementById('settings-panel-heading');
const settingsNavTabs = [...document.querySelectorAll('.settings-nav-item[role="tab"]')];
const prefModelList = document.getElementById('pref-model-list');
const prefListEmpty = document.getElementById('pref-list-empty');
const btnOpenAddModel = document.getElementById('btn-open-add-model');
const addModelOverlay = document.getElementById('add-model-overlay');
const selectProvider = document.getElementById('select-provider');
const providerStatus = document.getElementById('provider-status');
const providerKeyRow = document.getElementById('provider-key-row');
const providerBaseUrlRow = document.getElementById('provider-baseurl-row');
const inputApiKey = document.getElementById('input-api-key');
const btnRemoveApiKey = document.getElementById('btn-remove-api-key');
const inputBaseUrl = document.getElementById('input-base-url');
const providerInsecureRow = document.getElementById('provider-insecure-row');
const inputInsecureTls = document.getElementById('input-insecure-tls');
const openaiReasoningSection = document.getElementById('openai-reasoning-section');
const selectPopupReasoning = document.getElementById('select-popup-reasoning');
const selectModel = document.getElementById('select-model');
const btnLoadModels = document.getElementById('btn-load-models');
const modelLoadProviderLabel = document.getElementById('model-load-provider-label');
const modelStatus = document.getElementById('model-status');
const btnAddPresetRow = document.getElementById('btn-add-preset-row');
const btnAddModelCloseX = document.getElementById('btn-add-model-close-x');
const btnAddModelClose = document.getElementById('btn-add-model-close');
const btnSettingsSave = document.getElementById('btn-settings-save');
const btnSettingsClose = document.getElementById('btn-settings-close');
const btnSettingsFooterClose = document.getElementById('btn-settings-footer-close');
const inputGlobalSystemPrompt = document.getElementById('input-global-system-prompt');
const selectAppLocale = document.getElementById('select-app-locale');
const inputMaxToolRounds = document.getElementById('input-max-tool-rounds');
const modalEncryptionWarning = document.getElementById('modal-encryption-warning');
const modalSaveError = document.getElementById('modal-save-error');
const btnFolderHistory = document.getElementById('btn-folder-history');
const folderHistoryMenu = document.getElementById('folder-history-menu');
const welcomeRecentSection = document.getElementById('welcome-recent');
const welcomeRecentList = document.getElementById('welcome-recent-list');
const welcomeActionsList = document.getElementById('welcome-actions-list');

initTheme({ themeToggle, iconSun, iconMoon });

let syncInputHeightRaf = null;
function syncChatInputHeight() {
  if (syncInputHeightRaf !== null) return;
  syncInputHeightRaf = requestAnimationFrame(() => {
    syncInputHeightRaf = null;
    const el = chatInput;
    el.style.height = '0px';
    const h = el.scrollHeight;
    el.style.height = `${h}px`;
    if (chatInputRow) {
      chatInputRow.classList.toggle('chat-input-row--multiline', h > 52);
    }
  });
}

chatInput.addEventListener('input', syncChatInputHeight);
window.addEventListener('resize', syncChatInputHeight);
let chatInputRowResizeObserver = null;
if (typeof ResizeObserver !== 'undefined' && chatInputRow) {
  chatInputRowResizeObserver = new ResizeObserver(() => syncChatInputHeight());
  chatInputRowResizeObserver.observe(chatInputRow);
}

window.addEventListener('beforeunload', () => {
  if (syncInputHeightRaf !== null) {
    cancelAnimationFrame(syncInputHeightRaf);
    syncInputHeightRaf = null;
  }
  chatInputRowResizeObserver?.disconnect();
});

function setContentPaneVisible(visible) {
  if (visible) {
    workspace.classList.remove('workspace--no-preview');
    iconContentPaneVisible.classList.remove('hidden');
    iconContentPaneHidden.classList.add('hidden');
    btnToggleContentPane.title = 'Mittlere Vorschau ausblenden';
    btnToggleContentPane.setAttribute('aria-label', 'Mittlere Vorschau ausblenden');
    btnToggleContentPane.setAttribute('aria-pressed', 'true');
  } else {
    workspace.classList.add('workspace--no-preview');
    iconContentPaneVisible.classList.add('hidden');
    iconContentPaneHidden.classList.remove('hidden');
    btnToggleContentPane.title = 'Mittlere Vorschau einblenden';
    btnToggleContentPane.setAttribute('aria-label', 'Mittlere Vorschau einblenden');
    btnToggleContentPane.setAttribute('aria-pressed', 'false');
  }
}

btnToggleContentPane.addEventListener('click', async () => {
  const wasVisible = !workspace.classList.contains('workspace--no-preview');
  const visibleAfterToggle = !wasVisible;
  setContentPaneVisible(visibleAfterToggle);
  try {
    await api.setUIPrefs({ contentPaneVisible: visibleAfterToggle });
  } catch {
    setContentPaneVisible(wasVisible);
  }
});

const modelPicker = initChatModelPicker({
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
});

const voice = initWhisperRecorder({
  api,
  appStore,
  btnChatMic,
  chatVoiceStatus,
  chatInput,
  onInputChanged: syncChatInputHeight,
});

const chatStream = initChatStream({
  api,
  appStore,
  chatMessagesEl,
  chatInput,
  btnChatSend,
  chatTokenUsageEl,
  onInputChanged: syncChatInputHeight,
  stopChatVoiceListening: voice.stopChatVoiceListening,
  activeProviderConfigured: () => modelPicker.activeProviderConfigured(),
  syncLiveDot: () => modelPicker.syncLiveDot(),
});

const chatHistory = initChatHistoryDrawer({
  api,
  appStore,
  chatHistoryDrawer,
  chatHistoryList,
  chatHistoryEmpty,
  btnChatHistory,
  stopChatVoiceListening: voice.stopChatVoiceListening,
  persistCurrentChat: chatStream.persistCurrentChat,
  renderChatMessages: chatStream.renderChatMessages,
  updateChatChrome: () => modelPicker.updateChatChrome(),
  onInputChanged: syncChatInputHeight,
  setChatTokenUsage: (usage) => chatStream.setChatTokenUsage(usage),
  resetChatTokenUsage: () => chatStream.resetChatTokenUsage(),
  onNewChatStarted: async () => {
    await chatStream.startNewChat();
    modelPicker.updateChatChrome();
  },
});

const settingsModal = initSettingsModal({
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
  stopChatVoiceListening: voice.stopChatVoiceListening,
  closeChatModelMenu: () => modelPicker.closeChatModelMenu(),
  refreshLLMState: () => modelPicker.refreshLLMState(),
  findProviderMeta: (id) => modelPicker.findProviderMeta(id),
  updateChatChrome: () => modelPicker.updateChatChrome(),
  DEFAULT_MAX_TOOL_ROUNDS,
});

const fileTree = initFileTree({
  api,
  appStore,
  treeContainer,
  welcomeEl,
  filePreview,
  fileInfo,
  previewFilename,
  previewMeta,
  previewContent,
  infoFilename,
  infoSize,
  infoModified,
  infoType,
  projectName,
  btnFolderHistory,
  folderHistoryMenu,
  welcomeRecentSection,
  welcomeRecentList,
  welcomeActionsList,
  chatInput,
  onInputChanged: syncChatInputHeight,
  onWorkspaceChanged: async (folderPath) => {
    await chatStream.loadChatForWorkspace(folderPath);
  },
  onProjectOpened: () => modelPicker.updateChatChrome(),
  sendChatMessage: () => chatStream.sendChatMessage(),
  activeProviderConfigured: () => modelPicker.activeProviderConfigured(),
});

fileTree.setHistoryDrawerCloseOnEscape(() => {
  if (!chatHistoryDrawer.classList.contains('hidden')) {
    chatHistory.setHistoryDrawerOpen(false);
  }
});

async function openFolderViaDialog() {
  const folderPath = await api.openFolder();
  if (folderPath) {
    await fileTree.openProject(folderPath);
  }
}

btnOpen.addEventListener('click', openFolderViaDialog);

const welcomeCta = document.getElementById('welcome-cta');
if (welcomeCta) {
  welcomeCta.addEventListener('click', openFolderViaDialog);
}

document.addEventListener('click', (e) => {
  if (!chatHistoryDrawer.classList.contains('hidden')) {
    chatHistory.setHistoryDrawerOpen(false);
  }
});

btnChatNew.addEventListener('click', () => chatHistory.startNewChatWithHistory());

modelPicker.refreshLLMState();

(async () => {
  let uiPrefs = { contentPaneVisible: true, appLocale: 'de' };
  try {
    uiPrefs = await api.getUIPrefs();
    setContentPaneVisible(uiPrefs.contentPaneVisible !== false);
    settingsModal.applyShellLocale(uiPrefs.appLocale === 'en' ? 'en' : 'de');
  } catch {
    setContentPaneVisible(true);
  }
  initSidebarResizer({
    divider,
    sidebar,
    workspace,
    chatDivider,
    chatPanel,
    api,
    initialSidebarWidth: uiPrefs.sidebarWidth,
    initialChatPanelWidth: uiPrefs.chatPanelWidth,
  });
  const { folderPath } = await api.getLastFolder();
  if (folderPath) {
    await fileTree.openProject(folderPath);
  } else {
    await chatStream.loadChatForWorkspace(null);
    await fileTree.refreshWelcomeRecent();
    modelPicker.updateChatChrome();
  }
  syncChatInputHeight();
})();
