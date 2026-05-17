import {
  isTextFile,
  getExtension,
  formatSize,
  markdownToSafeHtml,
  svgChevron,
  svgFolder,
  svgFile,
} from './utils/helpers.js';
import { appStore } from './state/store.js';
import { initTheme } from './components/ThemeManager.js';
import { initSidebarResizer } from './components/SidebarResizer.js';
import { folderDepthSortKey, parentDirFromItemPath } from './components/FileTree.js';

const api = window.electronAPI;

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
const settingsNavTabs = [...document.querySelectorAll('.settings-nav-item[role=\"tab\"]')];
const prefModelList = document.getElementById('pref-model-list');
const prefListEmpty = document.getElementById('pref-list-empty');
const btnOpenAddModel = document.getElementById('btn-open-add-model');
const addModelOverlay = document.getElementById('add-model-overlay');
const selectProvider = document.getElementById('select-provider');
const providerStatus = document.getElementById('provider-status');
const providerKeyRow = document.getElementById('provider-key-row');
const providerBaseUrlRow = document.getElementById('provider-baseurl-row');
const inputApiKey = document.getElementById('input-api-key');
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

let settingsDraftPresets = [];
let settingsDraftActivePresetId = null;
let settingsCredentialDraft = {};
let chatModelMenuOpen = false;

const DEFAULT_MAX_TOOL_ROUNDS = 14;

initTheme({ themeToggle, iconSun, iconMoon });
initSidebarResizer({ divider, sidebar, workspace, chatDivider, chatPanel });

function syncChatInputHeight() {
  const el = chatInput;
  el.style.height = '0px';
  const h = el.scrollHeight;
  el.style.height = `${h}px`;
  if (chatInputRow) {
    chatInputRow.classList.toggle('chat-input-row--multiline', h > 52);
  }
}

chatInput.addEventListener('input', syncChatInputHeight);
window.addEventListener('resize', syncChatInputHeight);
if (typeof ResizeObserver !== 'undefined' && chatInputRow) {
  const ro = new ResizeObserver(() => syncChatInputHeight());
  ro.observe(chatInputRow);
}

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

// ── Folder Open ──

async function openFolderViaDialog() {
  const folderPath = await api.openFolder();
  if (folderPath) {
    openProject(folderPath);
  }
}

btnOpen.addEventListener('click', openFolderViaDialog);

// Phase 3: Welcome-CTA verlinkt zum gleichen Folder-Dialog.
const welcomeCta = document.getElementById('welcome-cta');
if (welcomeCta) {
  welcomeCta.addEventListener('click', openFolderViaDialog);
}

// Phase 5 E: Welcome-Sektionen (Recent Folders + Quick Actions).
const welcomeRecentSection = document.getElementById('welcome-recent');
const welcomeRecentList = document.getElementById('welcome-recent-list');
const welcomeActionsList = document.getElementById('welcome-actions-list');

const QUICK_ACTION_PROMPTS = {
  analyse:
    'Erklaere mir die Struktur dieses Projekts: Welche Hauptordner gibt es, was machen sie, und wie ist der Code organisiert?',
  review:
    'Mach einen Code-Review der wichtigsten Dateien in diesem Projekt. Achte auf Architektur, Wartbarkeit und Auffaelligkeiten.',
  test:
    'Welche Tests sollten in diesem Projekt ergaenzt werden? Schlage konkrete Test-Faelle fuer die kritischen Code-Pfade vor.',
  doc:
    'Fasse zusammen, worum es in diesem Projekt geht. Nutze README, package.json und die wichtigsten Quellen.',
};

function renderWelcomeRecent(paths) {
  if (!welcomeRecentSection || !welcomeRecentList) return;
  welcomeRecentList.innerHTML = '';
  if (!paths || paths.length === 0) {
    welcomeRecentSection.classList.add('hidden');
    return;
  }
  // Top 4 reichen visuell — fuer mehr ist das Folder-History-Menu da.
  const top = paths.slice(0, 4);
  for (const p of top) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip chip--recent';
    btn.setAttribute('role', 'listitem');
    btn.title = p;

    const main = document.createElement('span');
    main.className = 'chip-recent-main';

    const name = document.createElement('span');
    name.className = 'chip-recent-name';
    name.textContent = p.split('/').pop() || p;

    const sub = document.createElement('span');
    sub.className = 'chip-recent-path';
    sub.textContent = p;

    main.appendChild(name);
    main.appendChild(sub);
    btn.appendChild(main);

    const arrow = document.createElement('span');
    arrow.className = 'chip-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '\u2192';
    btn.appendChild(arrow);

    btn.addEventListener('click', () => {
      if (p !== appStore.rootPath) openProject(p);
    });
    welcomeRecentList.appendChild(btn);
  }
  welcomeRecentSection.classList.remove('hidden');
}

async function refreshWelcomeRecent() {
  if (!welcomeRecentSection) return;
  try {
    const { paths } = await api.getFolderHistory();
    renderWelcomeRecent(Array.isArray(paths) ? paths : []);
  } catch {
    renderWelcomeRecent([]);
  }
}

if (welcomeActionsList) {
  welcomeActionsList.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip[data-action]');
    if (!chip) return;
    const action = chip.dataset.action;
    const prompt = QUICK_ACTION_PROMPTS[action];
    if (!prompt) return;
    chatInput.value = prompt;
    syncChatInputHeight();
    chatInput.focus();
    if (appStore.rootPath && activeProviderConfigured()) {
      sendChatMessage();
    }
  });
}

async function openProject(folderPath) {
  const workspaceChanged = appStore.rootPath !== folderPath;
  appStore.rootPath = folderPath;
  const name = folderPath.split('/').pop() || folderPath;
  projectName.textContent = name;
  document.title = 'Weyouze Anything';

  treeContainer.innerHTML = '';
  showWelcome();

  await loadTreeLevel(treeContainer, folderPath, 0);
  if (workspaceChanged) {
    await loadChatForWorkspace(folderPath);
  }
  updateChatChrome();
  await api.setLastFolder(folderPath);
  refreshFolderHistory();
  refreshWelcomeRecent();
}

// ── Folder History Dropdown ──

const btnFolderHistory = document.getElementById('btn-folder-history');
const folderHistoryMenu = document.getElementById('folder-history-menu');

async function refreshFolderHistory() {
  try {
    const { paths } = await api.getFolderHistory();
    renderFolderHistory(Array.isArray(paths) ? paths : []);
  } catch {
    renderFolderHistory([]);
  }
}

function renderFolderHistory(paths) {
  folderHistoryMenu.innerHTML = '';
  if (!paths.length) {
    const empty = document.createElement('div');
    empty.className = 'folder-history-empty';
    empty.textContent = 'Noch keine zuletzt geöffneten Ordner.';
    folderHistoryMenu.appendChild(empty);
    return;
  }
  for (const p of paths) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'folder-history-item';
    btn.setAttribute('role', 'menuitem');
    btn.title = p;

    const name = document.createElement('span');
    name.className = 'folder-history-name';
    name.textContent = p.split('/').pop() || p;

    const sub = document.createElement('span');
    sub.className = 'folder-history-path';
    sub.textContent = p;

    btn.appendChild(name);
    btn.appendChild(sub);
    btn.addEventListener('click', () => {
      closeFolderHistoryMenu();
      if (p !== appStore.rootPath) openProject(p);
    });
    folderHistoryMenu.appendChild(btn);
  }
}

function openFolderHistoryMenu() {
  folderHistoryMenu.classList.remove('hidden');
  folderHistoryMenu.setAttribute('aria-hidden', 'false');
  btnFolderHistory.setAttribute('aria-expanded', 'true');
}

function closeFolderHistoryMenu() {
  folderHistoryMenu.classList.add('hidden');
  folderHistoryMenu.setAttribute('aria-hidden', 'true');
  btnFolderHistory.setAttribute('aria-expanded', 'false');
}

btnFolderHistory.addEventListener('click', async (e) => {
  e.stopPropagation();
  const isOpen = btnFolderHistory.getAttribute('aria-expanded') === 'true';
  if (isOpen) {
    closeFolderHistoryMenu();
    return;
  }
  await refreshFolderHistory();
  openFolderHistoryMenu();
});

document.addEventListener('click', (e) => {
  if (folderHistoryMenu.classList.contains('hidden')) return;
  if (folderHistoryMenu.contains(e.target) || btnFolderHistory.contains(e.target)) return;
  closeFolderHistoryMenu();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // Phase 5 (Review #21): Escape schliesst auch den Chat-History-Drawer.
  // Reihenfolge: Folder-History zuerst, dann Chat-History.
  if (!folderHistoryMenu.classList.contains('hidden')) {
    closeFolderHistoryMenu();
    return;
  }
  if (!chatHistoryDrawer.classList.contains('hidden')) {
    setHistoryDrawerOpen(false);
  }
});

treeContainer.addEventListener('dragover', (e) => {
  if (!appStore.rootPath || !appStore.dragSourcePath) return;
  const overItem = e.target.closest('.tree-item');
  if (overItem && overItem.dataset.isDirectory === 'true') return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  treeContainer.classList.add('drop-target-root');
});

treeContainer.addEventListener('dragleave', (e) => {
  if (!treeContainer.contains(e.relatedTarget)) {
    treeContainer.classList.remove('drop-target-root');
  }
});

treeContainer.addEventListener('drop', async (e) => {
  clearDragVisualState();
  if (!appStore.rootPath || !appStore.dragSourcePath) return;
  const overItem = e.target.closest('.tree-item');
  if (overItem && overItem.dataset.isDirectory === 'true') return;
  e.preventDefault();
  const sourcePath = appStore.dragSourcePath;
  if (!sourcePath) return;
  const expandedBefore = collectExpandedFolderPaths();
  const result = await api.moveItem(sourcePath, appStore.rootPath);
  if (result.error) {
    console.error('Move failed:', result.error);
    clearDragVisualState();
    return;
  }
  treeContainer.innerHTML = '';
  await loadTreeLevel(treeContainer, appStore.rootPath, 0);
  await restoreExpandedFolders(expandedBefore);
  clearDragVisualState();
});

// ── Tree View ──

async function loadTreeLevel(parentEl, dirPath, depth) {
  const items = await api.readDirectory(dirPath);

  for (const item of items) {
    const row = document.createElement('div');
    row.classList.add('tree-item');
    row.dataset.path = item.path;
    row.dataset.isDirectory = item.isDirectory;
    row.setAttribute('draggable', 'true');

    const indent = document.createElement('span');
    indent.classList.add('indent');
    indent.style.width = `${depth * 16 + 4}px`;
    row.appendChild(indent);

    const arrow = document.createElement('span');
    arrow.classList.add('arrow');
    if (item.isDirectory) {
      arrow.innerHTML = svgChevron();
    } else {
      arrow.classList.add('hidden');
    }
    row.appendChild(arrow);

    const icon = document.createElement('span');
    icon.classList.add('icon');
    icon.innerHTML = item.isDirectory ? svgFolder() : svgFile(item.name);
    row.appendChild(icon);

    const label = document.createElement('span');
    label.classList.add('label');
    label.textContent = item.name;
    row.appendChild(label);

    row.addEventListener('dragstart', (e) => {
      appStore.dragSourcePath = item.path;
      appStore.dragSourceRow = row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.path);
    });

    row.addEventListener('dragend', () => {
      clearDragVisualState();
      appStore.dragSourcePath = null;
      appStore.dragSourceRow = null;
    });

    if (item.isDirectory) {
      row.addEventListener('dragover', handleDragOver);
      row.addEventListener('dragenter', handleDragEnter);
      row.addEventListener('dragleave', handleDragLeave);
      row.addEventListener('drop', (e) => handleDrop(e, item.path, row, depth));
    }

    parentEl.appendChild(row);

    if (item.isDirectory) {
      const childContainer = document.createElement('div');
      childContainer.classList.add('tree-children');
      childContainer.dataset.path = item.path;
      childContainer.dataset.loaded = 'false';
      parentEl.appendChild(childContainer);

      row.addEventListener('click', () => toggleFolder(row, childContainer, item.path, depth + 1));
    } else {
      row.addEventListener('click', () => selectFile(row, item));
    }
  }
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
  e.preventDefault();
  const row = e.currentTarget;
  if (row === appStore.dragSourceRow) return;
  clearDropTarget();
  row.classList.add('drop-target');
  appStore.currentDropTarget = row;
}

function handleDragLeave(e) {
  const row = e.currentTarget;
  if (!row.contains(e.relatedTarget)) {
    row.classList.remove('drop-target');
    if (appStore.currentDropTarget === row) appStore.currentDropTarget = null;
  }
}

function clearDropTarget() {
  if (appStore.currentDropTarget) {
    appStore.currentDropTarget.classList.remove('drop-target');
    appStore.currentDropTarget = null;
  }
}

function clearDragVisualState() {
  treeContainer.classList.remove('drop-target-root');
  for (const el of treeContainer.querySelectorAll('.tree-item.drop-target')) {
    el.classList.remove('drop-target');
  }
  for (const el of treeContainer.querySelectorAll('.tree-item.dragging')) {
    el.classList.remove('dragging');
  }
  appStore.currentDropTarget = null;
}

function collectExpandedFolderPaths() {
  const paths = [];
  for (const el of treeContainer.querySelectorAll('.tree-children.expanded')) {
    const p = el.dataset.path;
    if (p) paths.push(p);
  }
  return paths;
}

async function restoreExpandedFolders(paths) {
  const unique = [...new Set(paths)].sort(
    (a, b) => folderDepthSortKey(a) - folderDepthSortKey(b)
  );
  for (const p of unique) {
    await expandFolderAtPath(p);
  }
}

function loadDepthFromTreeRow(row) {
  if (!row) return 1;
  const w = parseInt(row.querySelector('.indent')?.style.width || '4', 10);
  return Math.round(w / 16) + 1;
}

async function expandFolderAtPath(dirPath) {
  const childContainer = treeContainer.querySelector(
    `.tree-children[data-path="${CSS.escape(dirPath)}"]`
  );
  if (!childContainer) return;
  const row = childContainer.previousElementSibling;
  if (!row || row.dataset.isDirectory !== 'true') return;
  const arrow = row.querySelector('.arrow');
  const depth = loadDepthFromTreeRow(row);
  childContainer.innerHTML = '';
  await loadTreeLevel(childContainer, dirPath, depth);
  childContainer.dataset.loaded = 'true';
  childContainer.classList.add('expanded');
  if (arrow) arrow.classList.add('expanded');
}

async function handleDrop(e, destDir, dropRow, depth) {
  e.preventDefault();
  e.stopPropagation();
  clearDragVisualState();

  const sourcePath = appStore.dragSourcePath || e.dataTransfer.getData('text/plain');
  if (!sourcePath || sourcePath === destDir) return;

  const expandedBefore = collectExpandedFolderPaths();
  const result = await api.moveItem(sourcePath, destDir);
  if (result.error) {
    console.error('Move failed:', result.error);
    clearDragVisualState();
    return;
  }

  const sourceParent = parentDirFromItemPath(sourcePath);
  await refreshParentOf(sourcePath);
  if (sourceParent !== destDir) {
    await refreshFolder(destDir);
  }
  await restoreExpandedFolders(expandedBefore);
  clearDragVisualState();
}

async function refreshParentOf(itemPath) {
  const parts = itemPath.split('/');
  parts.pop();
  const parentDir = parts.join('/') || '/';
  await refreshFolder(parentDir);
}

async function refreshFolder(dirPath) {
  if (dirPath === appStore.rootPath) {
    const expandedBefore = collectExpandedFolderPaths();
    treeContainer.innerHTML = '';
    await loadTreeLevel(treeContainer, appStore.rootPath, 0);
    await restoreExpandedFolders(expandedBefore);
    return;
  }
  const childContainer = treeContainer.querySelector(
    `.tree-children[data-path="${CSS.escape(dirPath)}"]`
  );
  if (childContainer && childContainer.dataset.loaded === 'true') {
    const wasExpanded = childContainer.classList.contains('expanded');
    childContainer.innerHTML = '';
    const row = childContainer.previousElementSibling;
    const depthVal = loadDepthFromTreeRow(row);
    await loadTreeLevel(childContainer, dirPath, depthVal);
    childContainer.dataset.loaded = 'true';
    if (wasExpanded) {
      childContainer.classList.add('expanded');
      const arrow = row?.querySelector('.arrow');
      if (arrow) arrow.classList.add('expanded');
    }
  }
}

async function toggleFolder(row, childContainer, dirPath, depth) {
  const arrow = row.querySelector('.arrow');
  const isExpanded = childContainer.classList.contains('expanded');

  if (isExpanded) {
    childContainer.classList.remove('expanded');
    arrow.classList.remove('expanded');
  } else {
    if (childContainer.dataset.loaded === 'false') {
      await loadTreeLevel(childContainer, dirPath, depth);
      childContainer.dataset.loaded = 'true';
    }
    childContainer.classList.add('expanded');
    arrow.classList.add('expanded');
  }

  setActiveItem(row);
  appStore.selectedPath = dirPath;
  appStore.selectedIsDirectory = true;
}

async function selectFile(row, item) {
  setActiveItem(row);
  appStore.selectedPath = item.path;
  appStore.selectedIsDirectory = false;
  await showFileContent(item);
}

function setActiveItem(row) {
  if (appStore.activeTreeItem) {
    appStore.activeTreeItem.classList.remove('active');
  }
  row.classList.add('active');
  appStore.activeTreeItem = row;
}

// ── Content Display ──

function showWelcome() {
  welcomeEl.classList.remove('hidden');
  filePreview.classList.add('hidden');
  fileInfo.classList.add('hidden');
}

async function showFileContent(item) {
  welcomeEl.classList.add('hidden');

  if (isTextFile(item.name)) {
    const result = await api.readFile(item.path);

    if (result.error) {
      showFileInfo(item, result.error);
      return;
    }

    filePreview.classList.remove('hidden');
    fileInfo.classList.add('hidden');
    previewFilename.textContent = item.name;
    previewMeta.textContent = formatSize(result.size);
    previewContent.textContent = result.content;
  } else {
    showFileInfo(item);
  }
}

function showFileInfo(item, errorMsg) {
  filePreview.classList.add('hidden');
  fileInfo.classList.remove('hidden');
  infoFilename.textContent = item.name;
  infoSize.textContent = errorMsg || formatSize(item.size);
  infoModified.textContent = new Date(item.modified).toLocaleString('de-DE');
  infoType.textContent = getExtension(item.name) || 'Unbekannt';
}

// ── Chat: Spracheingabe (ein Mikrofon-Button + Whisper) ──

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
  // a11y (Phase 2): sichtbares Status-Label, damit der Recording-Status
  // nicht nur ueber die rote Mic-Faerbung kommuniziert wird.
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
      syncChatInputHeight();
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

// ── OpenAI Chat ──

function inferChatTitle(messages) {
  const u = messages.find((m) => m.role === 'user');
  if (u && u.content) {
    const t = String(u.content).trim().replace(/\s+/g, ' ');
    if (t.length > 48) return `${t.slice(0, 47)}…`;
    return t || 'Chat';
  }
  return 'Neuer Chat';
}

function serializeChatMessagesForStorage(messages) {
  return messages.map((m) => {
    if (m.role === 'user') {
      return { role: 'user', content: String(m.content ?? '') };
    }
    if (m.role === 'assistant') {
      const row = {
        role: 'assistant',
        content: String(m.content ?? ''),
      };
      if (m.isError) row.isError = true;
      if (Array.isArray(m.toolTrace) && m.toolTrace.length) row.toolTrace = [...m.toolTrace];
      if (m.reasoningText && String(m.reasoningText).trim()) {
        row.reasoningText = String(m.reasoningText);
      }
      return row;
    }
    return null;
  }).filter(Boolean);
}

function normalizeLoadedMessages(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return null;
    if (m.role === 'user') {
      return { role: 'user', content: String(m.content ?? '') };
    }
    return {
      role: 'assistant',
      content: String(m.content ?? ''),
      toolTrace: Array.isArray(m.toolTrace) ? [...m.toolTrace] : [],
      reasoningText: typeof m.reasoningText === 'string' ? m.reasoningText : '',
      streaming: false,
      isError: Boolean(m.isError),
    };
  }).filter(Boolean);
}

function formatHistoryTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

async function persistCurrentChat() {
  if (!appStore.currentChatId || appStore.chatMessages.length === 0) return;
  const messages = serializeChatMessagesForStorage(appStore.chatMessages);
  if (messages.length === 0) return;
  const title = inferChatTitle(appStore.chatMessages);
  await api.upsertChatSession({
    id: appStore.currentChatId,
    workspaceRoot: appStore.currentChatWorkspace,
    title,
    updatedAt: Date.now(),
    messages,
  });
  await api.setActiveChatId(appStore.currentChatWorkspace, appStore.currentChatId);
}

async function loadChatForWorkspace(workspaceRoot) {
  stopChatVoiceListening();
  await persistCurrentChat();
  appStore.chatSessionId += 1;

  const hist = await api.getChatHistory(workspaceRoot);
  const sessions = Array.isArray(hist?.sessions) ? hist.sessions : [];
  if (hist?.activeChatId) {
    const s = sessions.find((x) => x.id === hist.activeChatId);
    if (s && Array.isArray(s.messages)) {
      appStore.currentChatId = s.id;
      appStore.currentChatWorkspace = workspaceRoot || null;
      appStore.chatMessages = normalizeLoadedMessages(s.messages);
      chatInput.value = '';
      syncChatInputHeight();
      renderChatMessages();
      return;
    }
    await api.setActiveChatId(workspaceRoot, null);
  }
  appStore.currentChatId = crypto.randomUUID();
  appStore.currentChatWorkspace = workspaceRoot || null;
  appStore.chatMessages = [];
  chatInput.value = '';
  syncChatInputHeight();
  renderChatMessages();
}

function setHistoryDrawerOpen(open) {
  chatHistoryDrawer.classList.toggle('hidden', !open);
  chatHistoryDrawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  btnChatHistory.setAttribute('aria-expanded', open ? 'true' : 'false');
}

async function renderHistoryList() {
  const hist = await api.getChatHistory(appStore.rootPath);
  const sessions = Array.isArray(hist.sessions) ? [...hist.sessions] : [];
  sessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  chatHistoryList.innerHTML = '';
  if (sessions.length === 0) {
    chatHistoryEmpty.classList.remove('hidden');
    return;
  }
  chatHistoryEmpty.classList.add('hidden');
  for (const s of sessions) {
    const row = document.createElement('div');
    row.className = 'chat-history-row';
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    if (s.id === appStore.currentChatId) row.classList.add('chat-history-row--current');
    const main = document.createElement('div');
    main.className = 'chat-history-row-main';
    const titleEl = document.createElement('span');
    titleEl.className = 'chat-history-row-title';
    titleEl.textContent = s.title || 'Chat';
    const meta = document.createElement('span');
    meta.className = 'chat-history-row-meta';
    meta.textContent = formatHistoryTime(s.updatedAt);
    main.appendChild(titleEl);
    main.appendChild(meta);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'chat-history-row-delete';
    del.title = 'Aus Verlauf entfernen';
    del.setAttribute('aria-label', 'Aus Verlauf entfernen');
    del.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
    row.appendChild(main);
    row.appendChild(del);

    const openThis = () => openChatSession(s.id);
    row.addEventListener('click', (e) => {
      if (e.target.closest('.chat-history-row-delete')) return;
      openThis();
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openThis();
      }
    });
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      removeChatFromHistory(s.id);
    });
    chatHistoryList.appendChild(row);
  }
}

async function openChatSession(id) {
  if (!id || id === appStore.currentChatId) {
    setHistoryDrawerOpen(false);
    return;
  }
  stopChatVoiceListening();
  await persistCurrentChat();
  appStore.chatSessionId += 1;
  const hist = await api.getChatHistory(appStore.rootPath);
  const s = hist.sessions?.find((x) => x.id === id);
  if (!s || !Array.isArray(s.messages)) {
    setHistoryDrawerOpen(false);
    return;
  }
  appStore.currentChatId = id;
  appStore.currentChatWorkspace = s.workspaceRoot || null;
  appStore.chatMessages = normalizeLoadedMessages(s.messages);
  chatInput.value = '';
  syncChatInputHeight();
  await api.setActiveChatId(appStore.currentChatWorkspace, id);
  renderChatMessages();
  updateChatChrome();
  setHistoryDrawerOpen(false);
  await renderHistoryList();
}

async function removeChatFromHistory(id) {
  await api.deleteChatSession(id);
  if (id === appStore.currentChatId) {
    stopChatVoiceListening();
    appStore.chatSessionId += 1;
    appStore.currentChatId = crypto.randomUUID();
    appStore.currentChatWorkspace = appStore.rootPath || null;
    appStore.chatMessages = [];
    chatInput.value = '';
    syncChatInputHeight();
    await api.setActiveChatId(appStore.currentChatWorkspace, null);
    renderChatMessages();
    updateChatChrome();
  }
  await renderHistoryList();
}

async function startNewChat() {
  stopChatVoiceListening();
  await persistCurrentChat();
  appStore.chatSessionId += 1;
  appStore.currentChatId = crypto.randomUUID();
  appStore.currentChatWorkspace = appStore.rootPath || null;
  appStore.chatMessages = [];
  chatInput.value = '';
  syncChatInputHeight();
  await api.setActiveChatId(appStore.currentChatWorkspace, null);
  renderChatMessages();
  updateChatChrome();
  setHistoryDrawerOpen(false);
  await renderHistoryList();
}

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

function closeChatModelMenu(/* restoreFocus */) {
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
    closeChatModelMenu(false);
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
    btnChatSend.disabled = true;
  } else if (!appStore.rootPath) {
    chatHint.textContent =
      `${modelHint ? `Aktiv: ${modelHint}` : 'Aktives Modell'} – Tipp: Öffne einen Ordner, damit der Assistent Dateien per Tool einlesen kann.`;
    chatHint.classList.remove('hidden');
    btnChatSend.disabled = false;
  } else {
    chatHint.classList.add('hidden');
    btnChatSend.disabled = false;
  }

  syncLiveDot();
}

function updateStreamingChrome() {
  const last = appStore.chatMessages[appStore.chatMessages.length - 1];
  if (!last?.streaming) return;
  const bubble = chatMessagesEl.querySelector('.chat-msg.assistant:last-of-type');
  if (!bubble) return;
  const phase = bubble.querySelector('.chat-phase');
  if (phase) {
    const ph = last.phase;
    if (ph === 'generating' || ph === 'idle') {
      phase.classList.add('hidden');
      phase.textContent = '';
    } else {
      phase.classList.remove('hidden');
      phase.textContent = 'Modell denkt nach …';
    }
  }
  const reasoningEl = bubble.querySelector('.chat-reasoning-stream');
  if (reasoningEl) {
    reasoningEl.textContent = last.reasoningText || '';
    if (last.reasoningText && last.reasoningText.length > 0) {
      reasoningEl.classList.remove('hidden');
    } else {
      reasoningEl.classList.add('hidden');
    }
  }
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}


// Drosselt das Live-Rendern des Markdown-Streams auf max. 1x pro Frame.
// Verhindert, dass schnelle Provider (z. B. Ollama lokal) den Parser pro
// Token aufrufen. Behaelt das Auto-Scroll am Bubble-Ende bei.
function scheduleStreamRender(streamEl, text) {
  if (!streamEl) return;
  if (appStore.streamRenderRaf) cancelAnimationFrame(appStore.streamRenderRaf);
  appStore.streamRenderRaf = requestAnimationFrame(() => {
    appStore.streamRenderRaf = 0;
    streamEl.innerHTML = markdownToSafeHtml(text);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  });
}

// ── Phase 2 (a11y): Hilfen fuer Tool-Status-Pill, Lang-Marker, Live-Indikator ──
//
// Tool-Aufrufe werden im UI als <details class="chat-tool-log"> gerendert.
// Die Regel "Status nie nur ueber Farbe" verlangt zusaetzlich Form + Text:
//  - Streaming: pulsierender Live-Dot + Pill "RUNNING" (lang=en)
//  - Fertig:    Check-Icon + Pill "DONE" (lang=en)
function buildToolStatusBadge(state /* 'running' | 'done' */) {
  const wrap = document.createElement('span');
  wrap.className = 'chat-tool-status';
  if (state === 'running') {
    const dot = document.createElement('span');
    dot.className = 'chat-tool-status-dot';
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', 'Aktiv');
    wrap.appendChild(dot);
    const pill = document.createElement('span');
    pill.className = 'chat-pill chat-pill--running';
    pill.setAttribute('lang', 'en');
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = 'Status: ';
    pill.appendChild(sr);
    pill.appendChild(document.createTextNode('RUNNING'));
    wrap.appendChild(pill);
  } else {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'chat-tool-status-check');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Abgeschlossen');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M3 8l3 3 7-7');
    svg.appendChild(path);
    wrap.appendChild(svg);
    const pill = document.createElement('span');
    pill.className = 'chat-pill chat-pill--done';
    pill.setAttribute('lang', 'en');
    const sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = 'Status: ';
    pill.appendChild(sr);
    pill.appendChild(document.createTextNode('DONE'));
    wrap.appendChild(pill);
  }
  return wrap;
}

// Baut <details class="chat-tool-log"> inkl. Status-Pill und befuellt
// die Trace-Zeilen. Ersetzt die fruehere doppelte Inline-Konstruktion.
function buildToolLog(trace, state /* 'running' | 'done' */) {
  const log = document.createElement('details');
  log.className = 'chat-tool-log';
  log.classList.add(state === 'running' ? 'chat-tool-log--running' : 'chat-tool-log--done');
  if (state === 'running') log.open = true;

  const summary = document.createElement('summary');
  summary.className = 'chat-tool-summary';

  const summaryText = document.createElement('span');
  summaryText.className = 'chat-tool-summary-text';
  summary.appendChild(summaryText);

  summary.appendChild(buildToolStatusBadge(state));
  log.appendChild(summary);

  const lines = document.createElement('div');
  lines.className = 'chat-tool-lines';
  log.appendChild(lines);

  if (Array.isArray(trace) && trace.length > 0) {
    for (const line of trace) {
      const row = document.createElement('div');
      row.className = 'chat-tool-line';
      row.textContent = typeof line === 'string' ? line : line.summary || '';
      lines.appendChild(row);
    }
    const lastLine = trace[trace.length - 1];
    summaryText.textContent =
      typeof lastLine === 'string' ? lastLine : lastLine.summary || '';
  }
  return log;
}

// Markiert die Konversation waehrend Streaming als "busy" (a11y-Pflicht aus
// docs/ui-design/doubleslash-a11y-regeln.md, Abschnitt Live-Regionen).
function syncChatBusyState() {
  const last = appStore.chatMessages[appStore.chatMessages.length - 1];
  const busy = !!(last && last.role === 'assistant' && last.streaming);
  chatMessagesEl.setAttribute('aria-busy', busy ? 'true' : 'false');
  // Phase 5 E: Live-Dot reflektiert den echten Verbindungs-Status.
  syncLiveDot();
}

// Phase 5 E: Connection-Live-Dot auf echten Provider-/Stream-Status koppeln.
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

function renderChatMessages() {
  chatMessagesEl.innerHTML = '';
  for (const m of appStore.chatMessages) {
    const li = document.createElement('li');
    const roleClass = m.role === 'user' ? 'user' : 'assistant';
    li.classList.add('chat-msg', roleClass);
    if (m.isError) li.classList.add('error');
    if (m.role === 'assistant' && !m.isError) {
      if (m.streaming) {
        const phaseEl = document.createElement('div');
        phaseEl.className = 'chat-phase';
        if (m.phase === 'generating' || m.phase === 'idle') {
          phaseEl.classList.add('hidden');
        } else {
          phaseEl.textContent = 'Modell denkt nach …';
        }
        li.appendChild(phaseEl);

        const reasoningEl = document.createElement('pre');
        reasoningEl.className = 'chat-reasoning-stream';
        reasoningEl.textContent = m.reasoningText || '';
        if (!(m.reasoningText && m.reasoningText.length)) {
          reasoningEl.classList.add('hidden');
        }
        li.appendChild(reasoningEl);

        li.appendChild(buildToolLog(m.toolTrace, 'running'));

        const stream = document.createElement('div');
        stream.className = 'chat-md-streaming chat-md';
        stream.innerHTML = markdownToSafeHtml(m.content || '');
        li.appendChild(stream);
      } else {
        if (Array.isArray(m.toolTrace) && m.toolTrace.length > 0) {
          li.appendChild(buildToolLog(m.toolTrace, 'done'));
        }
        if (m.reasoningText && m.reasoningText.trim()) {
          const det = document.createElement('details');
          det.className = 'chat-reasoning-details';
          const sum = document.createElement('summary');
          sum.textContent = 'Zwischenschritte (Modell)';
          const body = document.createElement('pre');
          body.className = 'chat-reasoning-body';
          body.textContent = m.reasoningText;
          det.appendChild(sum);
          det.appendChild(body);
          li.appendChild(det);
        }
        const inner = document.createElement('div');
        inner.className = 'chat-md';
        inner.innerHTML = markdownToSafeHtml(m.content);
        li.appendChild(inner);
      }
    } else {
      li.textContent = m.content;
    }
    chatMessagesEl.appendChild(li);
  }
  syncChatBusyState();
  chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
}

chatMessagesEl.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href');
  if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
    e.preventDefault();
    api.openExternal(href);
  }
});

async function sendChatMessage() {
  stopChatVoiceListening();
  const text = chatInput.value.trim();
  if (!text || !activeProviderConfigured()) return;
  const sessionAtSend = appStore.chatSessionId;
  chatInput.value = '';
  syncChatInputHeight();
  appStore.chatMessages.push({ role: 'user', content: text });
  renderChatMessages();
  btnChatSend.disabled = true;

  const payload = appStore.chatMessages.map(({ role, content }) => ({ role, content }));
  appStore.chatMessages.push({
    role: 'assistant',
    content: '',
    toolTrace: [],
    reasoningText: '',
    streaming: true,
    phase: 'waiting',
  });
  renderChatMessages();

  const offDelta =
    typeof api.onChatDelta === 'function'
      ? api.onChatDelta(({ text: deltaText }) => {
          const last = appStore.chatMessages[appStore.chatMessages.length - 1];
          if (!last || last.role !== 'assistant' || !last.streaming) return;
          last.content = (last.content || '') + (deltaText || '');
          const streamEl = chatMessagesEl.querySelector(
            '.chat-msg.assistant:last-of-type .chat-md-streaming'
          );
          if (streamEl) {
            scheduleStreamRender(streamEl, last.content);
          } else {
            renderChatMessages();
          }
        })
      : () => {};

  const offTool =
    typeof api.onChatToolLine === 'function'
      ? api.onChatToolLine(({ line }) => {
          const last = appStore.chatMessages[appStore.chatMessages.length - 1];
          if (!last || last.role !== 'assistant' || !last.streaming) return;
          if (!Array.isArray(last.toolTrace)) last.toolTrace = [];
          last.toolTrace.push(line);
          const wrap = chatMessagesEl.querySelector('.chat-msg.assistant:last-of-type .chat-tool-log');
          if (wrap) {
            const linesEl = wrap.querySelector('.chat-tool-lines');
            const sumTextEl = wrap.querySelector('.chat-tool-summary-text');
            const row = document.createElement('div');
            row.className = 'chat-tool-line';
            row.textContent = line;
            if (linesEl) linesEl.appendChild(row);
            else wrap.appendChild(row);
            if (sumTextEl) sumTextEl.textContent = line;
            chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
          } else {
            renderChatMessages();
          }
        })
      : () => {};

  const offProgress =
    typeof api.onChatProgress === 'function'
      ? api.onChatProgress((p) => {
          const last = appStore.chatMessages[appStore.chatMessages.length - 1];
          if (!last || last.role !== 'assistant' || !last.streaming) return;
          if (p.type === 'phase' && p.phase) {
            last.phase = p.phase;
            updateStreamingChrome();
          }
          if (p.type === 'reasoning' && p.text) {
            last.reasoningText = (last.reasoningText || '') + p.text;
            updateStreamingChrome();
          }
        })
      : () => {};

  let result;
  try {
    result = await api.chat(payload, {
      workspaceRoot: appStore.rootPath,
      selectedPath: appStore.selectedPath,
      selectedIsDirectory: appStore.selectedIsDirectory,
    });
  } finally {
    offDelta();
    offTool();
    offProgress();
  }

  btnChatSend.disabled = !activeProviderConfigured();
  if (sessionAtSend !== appStore.chatSessionId) return;

  const last = appStore.chatMessages[appStore.chatMessages.length - 1];
  if (result.error) {
    if (last && last.streaming) {
      appStore.chatMessages.pop();
    }
    appStore.chatMessages.push({ role: 'assistant', content: result.error, isError: true });
  } else if (last && last.role === 'assistant' && last.streaming) {
    last.streaming = false;
    last.content = result.content ?? '';
    last.toolTrace = Array.isArray(result.toolTrace) ? result.toolTrace : last.toolTrace || [];
  }
  renderChatMessages();
  await persistCurrentChat();
}

btnChatSend.addEventListener('click', sendChatMessage);

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});

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

const SETTINGS_NAV_LABELS = { models: 'Modelle', tools: 'Tools', general: 'Allgemein' };

function hydrateCredentialDraftFromLlmState() {
  settingsCredentialDraft = {};
  for (const p of appStore.llmState.providers || []) {
    settingsCredentialDraft[p.id] = {
      apiKey: '',
      baseUrl: (p.baseUrl || p.defaultBaseUrl || '').trim(),
      insecureTls: !!p.insecureTls,
    };
  }
}

function stashPopupCredentialInputs() {
  const id = selectProvider?.value;
  if (!id || !settingsCredentialDraft[id]) return;
  settingsCredentialDraft[id].apiKey = (inputApiKey.value || '').trim();
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
      baseUrl: (meta.baseUrl || meta.defaultBaseUrl || '').trim(),
      insecureTls: !!meta.insecureTls,
    };
  }
  const draft = settingsCredentialDraft[providerId];

  if (meta.fields?.apiKey) {
    providerKeyRow.classList.remove('hidden');
    inputApiKey.value = draft.apiKey || '';
    if (meta.hasKey) {
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
  } else {
    providerKeyRow.classList.add('hidden');
    inputApiKey.value = '';
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
  if (meta.configured) {
    lines.push(meta.fields?.apiKey ? 'Key gespeichert' : 'Konfiguriert');
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

function toggleChatModelDropdown() {
  if (!chatModelMenu || !btnChatModelPicker) return;
  if (!chatModelMenu.classList.contains('hidden')) {
    closeChatModelMenu(false);
    return;
  }
  const n = rebuildChatModelMenu();
  if (n === 0) return;
  chatModelMenuOpen = true;
  chatModelMenu.classList.remove('hidden');
  btnChatModelPicker.setAttribute('aria-expanded', 'true');
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

  if (meta.fields?.apiKey && !apiKey && !meta.hasKey) {
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

btnChatHistory.addEventListener('click', async (e) => {
  e.stopPropagation();
  const open = chatHistoryDrawer.classList.contains('hidden');
  if (open) await renderHistoryList();
  setHistoryDrawerOpen(open);
});

document.addEventListener('click', (e) => {
  if (!chatHistoryDrawer.classList.contains('hidden')) {
    setHistoryDrawerOpen(false);
  }
  if (chatModelMenuOpen && chatModelMenu && btnChatModelPicker) {
    const t = e.target;
    if (!t?.closest?.('.chat-model-picker-wrap')) {
      closeChatModelMenu(false);
    }
  }
});

chatHistoryDrawer.addEventListener('click', (e) => e.stopPropagation());

btnChatNew.addEventListener('click', () => startNewChat());
btnChatSettings.addEventListener('click', openSettingsModal);

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
    closeChatModelMenu(false);
    await persistActivePreset(pid);
  });
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

refreshLLMState();

(async () => {
  try {
    const uiPrefs = await api.getUIPrefs();
    setContentPaneVisible(uiPrefs.contentPaneVisible !== false);
    applyShellLocale(uiPrefs.appLocale === 'en' ? 'en' : 'de');
  } catch {
    setContentPaneVisible(true);
  }
  const { folderPath } = await api.getLastFolder();
  if (folderPath) {
    await openProject(folderPath);
  } else {
    await loadChatForWorkspace(null);
    await refreshWelcomeRecent();
  }
  syncChatInputHeight();
})();
