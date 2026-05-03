const api = window.electronAPI;

// ── Theme Toggle ──

const themeToggle = document.getElementById('theme-toggle');
const iconSun = document.getElementById('icon-sun');
const iconMoon = document.getElementById('icon-moon');

function setTheme(mode) {
  if (mode === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    iconSun.classList.remove('hidden');
    iconMoon.classList.add('hidden');
  } else {
    document.documentElement.removeAttribute('data-theme');
    iconSun.classList.add('hidden');
    iconMoon.classList.remove('hidden');
  }
  localStorage.setItem('theme', mode);
}

const savedTheme = localStorage.getItem('theme') || 'light';
setTheme(savedTheme);

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  setTheme(current === 'dark' ? 'light' : 'dark');
});

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
const chatModelPill = document.getElementById('chat-model-pill');
const chatLiveDot = document.getElementById('chat-live-dot');
const modalSettings = document.getElementById('modal-settings');
const modalSettingsBackdrop = document.getElementById('modal-settings-backdrop');
const selectProvider = document.getElementById('select-provider');
const providerStatus = document.getElementById('provider-status');
const providerKeyRow = document.getElementById('provider-key-row');
const providerBaseUrlRow = document.getElementById('provider-baseurl-row');
const inputApiKey = document.getElementById('input-api-key');
const inputBaseUrl = document.getElementById('input-base-url');
const selectModel = document.getElementById('select-model');
const btnLoadModels = document.getElementById('btn-load-models');
const modelStatus = document.getElementById('model-status');
const btnSettingsSave = document.getElementById('btn-settings-save');
const btnSettingsClear = document.getElementById('btn-settings-clear');
const btnSettingsClose = document.getElementById('btn-settings-close');
const modalEncryptionWarning = document.getElementById('modal-encryption-warning');
const modalSaveError = document.getElementById('modal-save-error');

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

let rootPath = null;
let activeTreeItem = null;
let selectedPath = null;
let selectedIsDirectory = false;

let dragSourcePath = null;
let dragSourceRow = null;
let currentDropTarget = null;

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
      if (p !== rootPath) openProject(p);
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
    if (rootPath && activeProviderConfigured()) {
      sendChatMessage();
    }
  });
}

async function openProject(folderPath) {
  const workspaceChanged = rootPath !== folderPath;
  rootPath = folderPath;
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
      if (p !== rootPath) openProject(p);
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
  if (!rootPath || !dragSourcePath) return;
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
  if (!rootPath || !dragSourcePath) return;
  const overItem = e.target.closest('.tree-item');
  if (overItem && overItem.dataset.isDirectory === 'true') return;
  e.preventDefault();
  const sourcePath = dragSourcePath;
  if (!sourcePath) return;
  const expandedBefore = collectExpandedFolderPaths();
  const result = await api.moveItem(sourcePath, rootPath);
  if (result.error) {
    console.error('Move failed:', result.error);
    clearDragVisualState();
    return;
  }
  treeContainer.innerHTML = '';
  await loadTreeLevel(treeContainer, rootPath, 0);
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
      dragSourcePath = item.path;
      dragSourceRow = row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.path);
    });

    row.addEventListener('dragend', () => {
      clearDragVisualState();
      dragSourcePath = null;
      dragSourceRow = null;
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
  if (row === dragSourceRow) return;
  clearDropTarget();
  row.classList.add('drop-target');
  currentDropTarget = row;
}

function handleDragLeave(e) {
  const row = e.currentTarget;
  if (!row.contains(e.relatedTarget)) {
    row.classList.remove('drop-target');
    if (currentDropTarget === row) currentDropTarget = null;
  }
}

function clearDropTarget() {
  if (currentDropTarget) {
    currentDropTarget.classList.remove('drop-target');
    currentDropTarget = null;
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
  currentDropTarget = null;
}

function collectExpandedFolderPaths() {
  const paths = [];
  for (const el of treeContainer.querySelectorAll('.tree-children.expanded')) {
    const p = el.dataset.path;
    if (p) paths.push(p);
  }
  return paths;
}

function folderDepthSortKey(dirPath) {
  return dirPath.split('/').filter(Boolean).length;
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

  const sourcePath = dragSourcePath || e.dataTransfer.getData('text/plain');
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

function parentDirFromItemPath(itemPath) {
  const parts = itemPath.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

async function refreshParentOf(itemPath) {
  const parts = itemPath.split('/');
  parts.pop();
  const parentDir = parts.join('/') || '/';
  await refreshFolder(parentDir);
}

async function refreshFolder(dirPath) {
  if (dirPath === rootPath) {
    const expandedBefore = collectExpandedFolderPaths();
    treeContainer.innerHTML = '';
    await loadTreeLevel(treeContainer, rootPath, 0);
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
  selectedPath = dirPath;
  selectedIsDirectory = true;
}

async function selectFile(row, item) {
  setActiveItem(row);
  selectedPath = item.path;
  selectedIsDirectory = false;
  await showFileContent(item);
}

function setActiveItem(row) {
  if (activeTreeItem) {
    activeTreeItem.classList.remove('active');
  }
  row.classList.add('active');
  activeTreeItem = row;
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

// ── Sidebar Resize ──

let isResizing = false;

divider.addEventListener('mousedown', (e) => {
  isResizing = true;
  divider.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  e.preventDefault();
});

let isResizingChat = false;

document.addEventListener('mousemove', (e) => {
  if (isResizing) {
    const newWidth = Math.max(150, Math.min(e.clientX, 600));
    sidebar.style.width = `${newWidth}px`;
    return;
  }
  if (isResizingChat && workspace) {
    const rect = workspace.getBoundingClientRect();
    const fromRight = rect.right - e.clientX;
    const minChat = 260;
    const maxChat = Math.max(minChat, Math.min(rect.width * 0.5, rect.width - 200));
    const w = Math.max(minChat, Math.min(fromRight, maxChat));
    chatPanel.style.width = `${w}px`;
  }
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    divider.classList.remove('dragging');
    document.body.style.cursor = '';
  }
  if (isResizingChat) {
    isResizingChat = false;
    chatDivider.classList.remove('dragging');
    document.body.style.cursor = '';
  }
});

chatDivider.addEventListener('mousedown', (e) => {
  isResizingChat = true;
  chatDivider.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  e.preventDefault();
});

// ── Chat: Spracheingabe (ein Mikrofon-Button + Whisper) ──

let voiceRecording = false;
let voiceMediaRecorder = null;
let voiceChunks = [];
let voiceStream = null;
let voiceTranscribing = false;

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
  if (voiceStream) {
    for (const track of voiceStream.getTracks()) track.stop();
    voiceStream = null;
  }
}

async function startVoiceRecording() {
  if (voiceRecording || voiceTranscribing) return;
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    setVoiceStatus(err.name === 'NotAllowedError' ? 'Mikrofonzugriff verweigert.' : `Mikrofon: ${err.message}`);
    return;
  }

  voiceChunks = [];
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  voiceMediaRecorder = new MediaRecorder(voiceStream, { mimeType });
  voiceMediaRecorder.ondataavailable = (e) => {
    if (e.data?.size > 0) voiceChunks.push(e.data);
  };
  voiceMediaRecorder.onstop = () => handleVoiceStopped();
  voiceMediaRecorder.start(250);

  voiceRecording = true;
  setMicUi(true);
  // a11y (Phase 2): sichtbares Status-Label, damit der Recording-Status
  // nicht nur ueber die rote Mic-Faerbung kommuniziert wird.
  setVoiceStatus('Aufnahme laeuft …');
}

function stopVoiceRecording() {
  if (!voiceRecording || !voiceMediaRecorder) return;
  voiceRecording = false;
  try { voiceMediaRecorder.stop(); } catch { /* already stopped */ }
  releaseVoiceStream();
}

async function handleVoiceStopped() {
  setMicUi(false);

  if (voiceChunks.length === 0) { setVoiceStatus(''); return; }
  const blob = new Blob(voiceChunks, { type: 'audio/webm' });
  voiceChunks = [];
  if (blob.size < 1000) { setVoiceStatus('Aufnahme zu kurz.'); return; }

  voiceTranscribing = true;
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
    voiceTranscribing = false;
    btnChatMic.disabled = false;
  }
}

function stopChatVoiceListening() {
  if (voiceRecording) stopVoiceRecording();
  releaseVoiceStream();
  setMicUi(false);
  if (!voiceTranscribing) setVoiceStatus('');
}

btnChatMic.addEventListener('click', () => {
  if (btnChatMic.disabled) return;
  if (voiceRecording) {
    stopVoiceRecording();
  } else {
    startVoiceRecording();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopChatVoiceListening();
});

// ── OpenAI Chat ──

let llmState = {
  encryptionAvailable: true,
  activeProvider: 'openai',
  providers: [],
};
let settingsDraftProviderId = null;
let chatMessages = [];
let chatSessionId = 0;
let currentChatId = '';
let currentChatWorkspace = null;

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
  if (!currentChatId || chatMessages.length === 0) return;
  const messages = serializeChatMessagesForStorage(chatMessages);
  if (messages.length === 0) return;
  const title = inferChatTitle(chatMessages);
  await api.upsertChatSession({
    id: currentChatId,
    workspaceRoot: currentChatWorkspace,
    title,
    updatedAt: Date.now(),
    messages,
  });
  await api.setActiveChatId(currentChatWorkspace, currentChatId);
}

async function loadChatForWorkspace(workspaceRoot) {
  stopChatVoiceListening();
  await persistCurrentChat();
  chatSessionId += 1;

  const store = await api.getChatHistory(workspaceRoot);
  const sessions = Array.isArray(store?.sessions) ? store.sessions : [];
  if (store?.activeChatId) {
    const s = sessions.find((x) => x.id === store.activeChatId);
    if (s && Array.isArray(s.messages)) {
      currentChatId = s.id;
      currentChatWorkspace = workspaceRoot || null;
      chatMessages = normalizeLoadedMessages(s.messages);
      chatInput.value = '';
      syncChatInputHeight();
      renderChatMessages();
      return;
    }
    await api.setActiveChatId(workspaceRoot, null);
  }
  currentChatId = crypto.randomUUID();
  currentChatWorkspace = workspaceRoot || null;
  chatMessages = [];
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
  const store = await api.getChatHistory(rootPath);
  const sessions = Array.isArray(store.sessions) ? [...store.sessions] : [];
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
    if (s.id === currentChatId) row.classList.add('chat-history-row--current');
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
  if (!id || id === currentChatId) {
    setHistoryDrawerOpen(false);
    return;
  }
  stopChatVoiceListening();
  await persistCurrentChat();
  chatSessionId += 1;
  const store = await api.getChatHistory(rootPath);
  const s = store.sessions?.find((x) => x.id === id);
  if (!s || !Array.isArray(s.messages)) {
    setHistoryDrawerOpen(false);
    return;
  }
  currentChatId = id;
  currentChatWorkspace = s.workspaceRoot || null;
  chatMessages = normalizeLoadedMessages(s.messages);
  chatInput.value = '';
  syncChatInputHeight();
  await api.setActiveChatId(currentChatWorkspace, id);
  renderChatMessages();
  updateChatChrome();
  setHistoryDrawerOpen(false);
  await renderHistoryList();
}

async function removeChatFromHistory(id) {
  await api.deleteChatSession(id);
  if (id === currentChatId) {
    stopChatVoiceListening();
    chatSessionId += 1;
    currentChatId = crypto.randomUUID();
    currentChatWorkspace = rootPath || null;
    chatMessages = [];
    chatInput.value = '';
    syncChatInputHeight();
    await api.setActiveChatId(currentChatWorkspace, null);
    renderChatMessages();
    updateChatChrome();
  }
  await renderHistoryList();
}

async function startNewChat() {
  stopChatVoiceListening();
  await persistCurrentChat();
  chatSessionId += 1;
  currentChatId = crypto.randomUUID();
  currentChatWorkspace = rootPath || null;
  chatMessages = [];
  chatInput.value = '';
  syncChatInputHeight();
  await api.setActiveChatId(currentChatWorkspace, null);
  renderChatMessages();
  updateChatChrome();
  setHistoryDrawerOpen(false);
  await renderHistoryList();
}

function findProviderMeta(providerId) {
  return (llmState.providers || []).find((p) => p.id === providerId) || null;
}

function activeProviderConfigured() {
  const p = findProviderMeta(llmState.activeProvider);
  return !!(p && p.configured);
}

async function refreshLLMState() {
  llmState = await api.getLLMState();
  updateChatChrome();
}

function updateChatChrome() {
  const active = findProviderMeta(llmState.activeProvider);
  const isConfigured = activeProviderConfigured();

  // Phase 3: Chat-Header-Meta dynamisch (Mono-Projektname + Modell-Pille).
  if (chatTitleEl) {
    if (rootPath) {
      const projectName = rootPath.split('/').pop() || rootPath;
      chatTitleEl.textContent = projectName;
      chatTitleEl.removeAttribute('lang');
    } else {
      chatTitleEl.textContent = 'Chat';
      chatTitleEl.removeAttribute('lang');
    }
  }
  if (chatModelPill) {
    if (active && active.model) {
      chatModelPill.textContent = active.model;
      chatModelPill.classList.remove('hidden');
    } else {
      chatModelPill.textContent = '';
      chatModelPill.classList.add('hidden');
    }
  }

  if (!isConfigured) {
    if (!llmState.encryptionAvailable) {
      chatHint.textContent =
        'Verschlüsselter Speicher ist nicht verfügbar. Ein API-Key kann hier nicht sicher gespeichert werden.';
    } else {
      chatHint.textContent = 'Konfiguriere ein Sprachmodell über das Zahnrad, um zu chatten.';
    }
    chatHint.classList.remove('hidden');
    btnChatSend.disabled = true;
  } else if (!rootPath) {
    chatHint.textContent =
      `Aktiv: ${active.name} · ${active.model || '(Modell nicht gesetzt)'} – Tipp: Öffne einen Ordner, damit der Assistent Dateien per Tool einlesen kann.`;
    chatHint.classList.remove('hidden');
    btnChatSend.disabled = false;
  } else {
    chatHint.classList.add('hidden');
    btnChatSend.disabled = false;
  }

  syncLiveDot();
}

function updateStreamingChrome() {
  const last = chatMessages[chatMessages.length - 1];
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

function markdownToSafeHtml(raw) {
  const text = String(raw ?? '');
  if (typeof marked !== 'undefined' && typeof marked.parse === 'function' && typeof DOMPurify !== 'undefined') {
    const html = marked.parse(text, { breaks: true, gfm: true });
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  }
  const esc = document.createElement('div');
  esc.textContent = text;
  return esc.innerHTML.replace(/\n/g, '<br>');
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
  const last = chatMessages[chatMessages.length - 1];
  const busy = !!(last && last.role === 'assistant' && last.streaming);
  chatMessagesEl.setAttribute('aria-busy', busy ? 'true' : 'false');
  // Phase 5 E: Live-Dot reflektiert den echten Verbindungs-Status.
  syncLiveDot();
}

// Phase 5 E: Connection-Live-Dot auf echten Provider-/Stream-Status koppeln.
function syncLiveDot() {
  if (!chatLiveDot) return;
  const last = chatMessages[chatMessages.length - 1];
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
  for (const m of chatMessages) {
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
        stream.className = 'chat-md-streaming';
        stream.textContent = m.content || '';
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
  const sessionAtSend = chatSessionId;
  chatInput.value = '';
  syncChatInputHeight();
  chatMessages.push({ role: 'user', content: text });
  renderChatMessages();
  btnChatSend.disabled = true;

  const payload = chatMessages.map(({ role, content }) => ({ role, content }));
  chatMessages.push({
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
          const last = chatMessages[chatMessages.length - 1];
          if (!last || last.role !== 'assistant' || !last.streaming) return;
          last.content = (last.content || '') + (deltaText || '');
          const streamEl = chatMessagesEl.querySelector(
            '.chat-msg.assistant:last-of-type .chat-md-streaming'
          );
          if (streamEl) {
            streamEl.textContent = last.content;
            chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
          } else {
            renderChatMessages();
          }
        })
      : () => {};

  const offTool =
    typeof api.onChatToolLine === 'function'
      ? api.onChatToolLine(({ line }) => {
          const last = chatMessages[chatMessages.length - 1];
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
          const last = chatMessages[chatMessages.length - 1];
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
      workspaceRoot: rootPath,
      selectedPath: selectedPath,
      selectedIsDirectory: selectedIsDirectory,
    });
  } finally {
    offDelta();
    offTool();
    offProgress();
  }

  btnChatSend.disabled = !activeProviderConfigured();
  if (sessionAtSend !== chatSessionId) return;

  const last = chatMessages[chatMessages.length - 1];
  if (result.error) {
    if (last && last.streaming) {
      chatMessages.pop();
    }
    chatMessages.push({ role: 'assistant', content: result.error, isError: true });
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

function renderProviderSelect() {
  selectProvider.innerHTML = '';
  for (const p of llmState.providers) {
    const opt = document.createElement('option');
    opt.value = p.id;
    // a11y (Phase 2): Provider-Namen sind englische Eigennamen (OpenAI,
    // Anthropic, Google, Ollama). lang=en sorgt dafuer, dass Screenreader
    // sie englisch aussprechen.
    opt.setAttribute('lang', 'en');
    const tags = [];
    if (p.id === llmState.activeProvider) tags.push('aktiv');
    if (p.configured) tags.push('konfiguriert');
    opt.textContent = tags.length ? `${p.name} – ${tags.join(', ')}` : p.name;
    selectProvider.appendChild(opt);
  }
  selectProvider.value = settingsDraftProviderId || llmState.activeProvider;
}

function renderModelSelect(currentValue, options) {
  selectModel.innerHTML = '';
  const seen = new Set();
  const add = (id, label) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const opt = document.createElement('option');
    opt.value = id;
    // a11y (Phase 2): Modell-IDs (gpt-4o-mini, claude-opus-4.7, ...) sind
    // technische englische Identifier — lang=en hilft dem Screenreader.
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

function applyProviderToForm(providerId) {
  const meta = findProviderMeta(providerId);
  if (!meta) return;
  settingsDraftProviderId = providerId;
  selectProvider.value = providerId;

  if (meta.fields?.apiKey) {
    providerKeyRow.classList.remove('hidden');
    inputApiKey.value = '';
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
    inputBaseUrl.value = meta.baseUrl || meta.defaultBaseUrl || '';
    inputBaseUrl.placeholder = meta.defaultBaseUrl || 'http://localhost:11434';
  } else {
    providerBaseUrlRow.classList.add('hidden');
    inputBaseUrl.value = '';
  }

  renderModelSelect(meta.model || meta.defaultModel || '', null);

  const lines = [];
  if (meta.apiBase) lines.push(`API: ${meta.apiBase}`);
  if (meta.id === llmState.activeProvider) lines.push('Aktuell aktiv');
  if (meta.configured) {
    lines.push(meta.fields?.apiKey ? 'Key gespeichert' : 'Konfiguriert');
  }
  setProviderStatus(lines.join(' · '), false);
  setModelStatus('');
  setModalError('');
}

// Phase 5 (Review #12-#13): Modal-A11y — Element merken, Focus-Trap auf Tab,
// Escape schliesst, beim Schliessen Focus zurueck auf den Trigger.
let lastFocusBeforeModal = null;

function getFocusableModalElements() {
  const dialog = modalSettings.querySelector('.modal-dialog');
  if (!dialog) return [];
  return [...dialog.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
}

function handleModalKeydown(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeSettingsModal();
    return;
  }
  if (e.key !== 'Tab') return;
  const focusable = getFocusableModalElements();
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

function openSettingsModal() {
  stopChatVoiceListening();
  setModalError('');
  setProviderStatus('');
  setModelStatus('');

  lastFocusBeforeModal = document.activeElement;

  modalSettings.classList.remove('hidden');
  modalSettings.setAttribute('aria-hidden', 'false');
  modalEncryptionWarning.classList.toggle('hidden', llmState.encryptionAvailable);

  settingsDraftProviderId = llmState.activeProvider;
  renderProviderSelect();
  applyProviderToForm(settingsDraftProviderId);

  modalSettings.addEventListener('keydown', handleModalKeydown);
  const focusable = getFocusableModalElements();
  if (focusable.length > 0) {
    queueMicrotask(() => focusable[0].focus());
  }
}

function closeSettingsModal() {
  modalSettings.classList.add('hidden');
  modalSettings.setAttribute('aria-hidden', 'true');
  modalSettings.removeEventListener('keydown', handleModalKeydown);
  settingsDraftProviderId = null;
  if (lastFocusBeforeModal && typeof lastFocusBeforeModal.focus === 'function') {
    try { lastFocusBeforeModal.focus(); } catch { /* ignore */ }
  }
  lastFocusBeforeModal = null;
}

async function loadModelsForCurrentDraft() {
  const providerId = settingsDraftProviderId;
  const meta = findProviderMeta(providerId);
  if (!meta) return;

  const apiKey = (inputApiKey.value || '').trim();
  const baseUrl = (inputBaseUrl.value || '').trim();

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

btnChatHistory.addEventListener('click', async (e) => {
  e.stopPropagation();
  const open = chatHistoryDrawer.classList.contains('hidden');
  if (open) await renderHistoryList();
  setHistoryDrawerOpen(open);
});

document.addEventListener('click', () => {
  if (!chatHistoryDrawer.classList.contains('hidden')) {
    setHistoryDrawerOpen(false);
  }
});

chatHistoryDrawer.addEventListener('click', (e) => e.stopPropagation());

btnChatNew.addEventListener('click', () => startNewChat());
btnChatSettings.addEventListener('click', openSettingsModal);
modalSettingsBackdrop.addEventListener('click', closeSettingsModal);
btnSettingsClose.addEventListener('click', closeSettingsModal);

selectProvider.addEventListener('change', () => {
  const id = selectProvider.value;
  if (!id) return;
  applyProviderToForm(id);
});

btnLoadModels.addEventListener('click', () => {
  loadModelsForCurrentDraft();
});

btnSettingsSave.addEventListener('click', async () => {
  setModalError('');
  const providerId = settingsDraftProviderId || llmState.activeProvider;
  const meta = findProviderMeta(providerId);
  if (!meta) {
    setModalError('Kein Anbieter ausgewählt.');
    return;
  }

  const apiKey = (inputApiKey.value || '').trim();
  const baseUrl = (inputBaseUrl.value || '').trim();
  const model = (selectModel.value || '').trim() || meta.defaultModel || '';

  if (meta.fields?.apiKey && !apiKey && !meta.hasKey) {
    setModalError('Bitte API-Key eingeben.');
    return;
  }
  if (meta.fields?.baseUrl && !baseUrl && !meta.baseUrl) {
    setModalError('Bitte Server-URL angeben.');
    return;
  }

  const payload = { providerId, model, makeActive: true };
  if (apiKey) payload.apiKey = apiKey;
  if (baseUrl) payload.baseUrl = baseUrl;

  btnSettingsSave.disabled = true;
  try {
    const res = await api.setProvider(payload);
    if (!res?.ok) {
      setModalError(res?.error || 'Speichern fehlgeschlagen.');
      return;
    }
    await refreshLLMState();
    closeSettingsModal();
  } finally {
    btnSettingsSave.disabled = false;
  }
});

btnSettingsClear.addEventListener('click', async () => {
  const providerId = settingsDraftProviderId || llmState.activeProvider;
  if (!providerId) return;
  stopChatVoiceListening();
  await api.clearProvider(providerId);
  chatSessionId += 1;
  currentChatId = crypto.randomUUID();
  currentChatWorkspace = rootPath || null;
  chatMessages = [];
  chatInput.value = '';
  syncChatInputHeight();
  await api.setActiveChatId(currentChatWorkspace, null);
  renderChatMessages();
  await refreshLLMState();
  // Reflect the cleared state in the modal (if still open)
  if (!modalSettings.classList.contains('hidden')) {
    settingsDraftProviderId = llmState.activeProvider;
    renderProviderSelect();
    applyProviderToForm(settingsDraftProviderId);
  }
});

refreshLLMState();

(async () => {
  try {
    const uiPrefs = await api.getUIPrefs();
    setContentPaneVisible(uiPrefs.contentPaneVisible !== false);
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

// ── Helpers ──

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'json', 'html', 'htm', 'css',
  'scss', 'less', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'sh', 'bash', 'zsh', 'py', 'rb', 'java', 'c', 'cpp', 'h', 'hpp',
  'cs', 'go', 'rs', 'swift', 'kt', 'scala', 'php', 'sql', 'r',
  'vue', 'svelte', 'astro', 'env', 'gitignore', 'dockerfile',
  'makefile', 'cmake', 'gradle', 'properties', 'log', 'csv', 'svg',
  'lock', 'editorconfig', 'prettierrc', 'eslintrc', 'babelrc',
]);

function isTextFile(filename) {
  const ext = getExtension(filename);
  if (!ext) {
    const lower = filename.toLowerCase();
    return ['makefile', 'dockerfile', 'readme', 'license', 'changelog'].some(
      (n) => lower === n || lower.startsWith(n + '.')
    );
  }
  return TEXT_EXTENSIONS.has(ext);
}

function getExtension(filename) {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return filename.slice(dotIndex + 1).toLowerCase();
}

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ── SVG Icons ──

function svgChevron() {
  return `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
    <path d="M3 1l4 4-4 4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function svgFolder() {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>`;
}

function svgFile(filename) {
  const ext = getExtension(filename);
  const colorMap = {
    js: '#f1e05a', ts: '#3178c6', jsx: '#61dafb', tsx: '#3178c6',
    json: '#a8d08d', html: '#e34c26', css: '#563d7c', scss: '#c6538c',
    py: '#3572A5', rb: '#cc342d', java: '#b07219', go: '#00ADD8',
    rs: '#dea584', md: '#519aba', svg: '#ff9900', xml: '#e44b23',
    yaml: '#cb171e', yml: '#cb171e', sh: '#89e051', sql: '#e38c00',
  };
  const color = colorMap[ext] || '#888';

  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="${color}">
    <path d="M4 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4.5L9.5 0H4zM9 1v3.5a.5.5 0 0 0 .5.5H13L9 1zM4 1h4v4h5v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"/>
  </svg>`;
}
