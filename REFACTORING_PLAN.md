# Refactoring-Plan: Weyouze Modularisierung

Dieser Plan beschreibt die schrittweise Migration der monolithischen Weyouze-Architektur in eine modulare, wartbare Struktur nach Electron Best Practices.

## Leitplanken für die Umsetzung
*Ziel: Jeder Zwischenschritt soll lauffähig bleiben und keine stillen Electron-Pfad- oder IPC-Regressions erzeugen.*

- **CommonJS beibehalten:** Das Projekt nutzt aktuell kein `"type": "module"`. Neue Main-, Preload- und Shared-Dateien daher zunächst mit `require(...)` und `module.exports` schreiben. ES-Module nur im Renderer aktivieren.
- **Keine Big-Bang-Migration:** Nach jedem verschobenen Modul `npm run start` ausführen und mindestens die betroffene Funktion manuell prüfen.
- **Ein Commit pro Sub-Phase:** Jede abgehakte Checkbox wird als eigener Commit gespeichert (z.B. `refactor(main): extract window management — 2.2`). Damit ist jeder Zwischenstand per `git bisect` auffindbar und einzelne Schritte sind isoliert zurückrollbar.
- **Pfadstrategie explizit halten:** Beim Verschieben von Main-Code ändert sich `__dirname`. Solange `preload.js` und `renderer/` noch am alten Ort liegen, müssen Pfade bewusst relativ zum Projektroot aufgelöst werden.
- **Dependencies injizieren:** IPC-Handler sollen benötigte Abhängigkeiten übergeben bekommen, z.B. `registerDialogHandlers({ ipcMain, dialog, getMainWindow })`, statt globale Variablen quer über Dateien zu teilen.
- **Services sind Singletons im Entry Point:** Provider-Registry, Storage-Service, FS-Service und Whisper-Service werden **einmalig** in `src/main/index.js` instanziiert und per Parameter an die Handler-Register-Funktionen weitergereicht. Kein `require(...)` einer Service-Factory aus einem Handler heraus, sonst entstehen doppelte Caches und doppelte `safeStorage`-Reads.
- **Bestehende Runtime-Verantwortlichkeiten erhalten:** Window-Erstellung, Media-Permissions, IPC-Registrierung, Provider-Zugriff und lokale Speicherung müssen nach dem Split weiterhin eindeutig initialisiert werden.
- **Persistenz-Formate sind tabu:** Schlüssel und Strukturen für Chat-History, Folder-History und LLM-Config (insbesondere die mit `safeStorage` verschlüsselten API-Keys) dürfen sich beim Refactoring nicht ändern, sonst verlieren bestehende Nutzer ihre Daten.

## Aufwandsschätzung (grob)

| Phase | Inhalt | Realistischer Aufwand |
| --- | --- | --- |
| 0 | Inventur, Git-Tag | ~30 min |
| 1 | Ordnerstruktur, IPC-Konstanten | ~30 min |
| 2 | Main-Prozess Modularisierung | 0.5 – 1 Tag |
| 3 | Preload Migration | ~30 min |
| 4 | Renderer Modularisierung | ~1 Tag (riskanteste Phase wegen ES-Module-Umstellung) |
| 5 | Aufräumen, Build-Prüfung | ~30 min |

Wenn eine Phase deutlich länger braucht als hier veranschlagt, ist das ein Signal, dass etwas Unerwartetes auftaucht — pausieren und Plan ggf. anpassen, statt mit Gewalt durchziehen.

## Phase 0: Inventur & Sicherheitsnetz
*Ziel: Vor dem ersten Move einen Vorher-Snapshot festhalten, gegen den am Ende verglichen werden kann.*

- [ ] **0.1 Git-Snapshot setzen**
  - Commit auf `main` mit allem Stand der Dinge.
  - Tag setzen: `git tag pre-refactor`. Das ist der Rollback-Anker, falls eine Phase entgleitet.
- [ ] **0.2 IPC-Inventur**
  - Liste alle `ipcMain.handle(...)`-Kanäle aus `main.js` und alle `ipcRenderer.invoke/.on(...)`-Aufrufe aus `preload.js` einmalig in einem kurzen Markdown-Abschnitt (z.B. unten in diesem Plan oder als separate Notiz).
  - Diese Liste dient später als Diff-Checkliste: Nach Phase 5 müssen exakt dieselben Kanäle existieren (ggf. unter neuen Namen, dann mit Mapping).
- [ ] **0.3 Persistenz-Inventur**
  - Notiere, wo die App schreibt: User-Data-Pfade für `llm-config.json`, `chat-history.json`, `ui-prefs.json`, `folder-history.json` (oder wie sie heißen). Inklusive der Schlüsselnamen, die mit `safeStorage` verschlüsselt sind.
  - Diese Daten dürfen sich beim Refactoring nicht im Format ändern.

## Phase 1: Vorbereitung & Infrastruktur
*Ziel: Die neue Ordnerstruktur anlegen und gemeinsame Konstanten auslagern, ohne bestehende Logik zu verändern.*

- [ ] **1.1 Neue Ordnerstruktur erstellen**
  - Lege das Verzeichnis `src/` im Root-Ordner an.
  - Erstelle darin die Unterordner: `src/main/`, `src/preload/`, `src/renderer/` und `src/shared/`.
- [ ] **1.2 Shared Constants anlegen**
  - Erstelle `src/shared/ipc-channels.js`.
  - Extrahiere alle Magic Strings für IPC-Kanäle (z.B. `'dialog:openFolder'`, `'openai:chat'`) aus `main.js` und `preload.js` in Konstanten und exportiere diese.
  - Nutze CommonJS (`module.exports = { ... }`), damit die Konstanten direkt in `main.js` und `preload.js` importierbar sind.
- [ ] **1.3 Konstanten integrieren**
  - Importiere die Konstanten in der bestehenden `main.js` und `preload.js` und ersetze die hartkodierten Strings.
  - Belasse Kanalnamen zunächst unverändert, damit nur die Definition zentralisiert wird und keine API-Migration entsteht.
  - *Test:* App starten und prüfen, ob die Kommunikation zwischen Main und Renderer noch funktioniert.

## Phase 2: Main-Prozess Modularisierung
*Ziel: Die 1.000 Zeilen lange `main.js` in fachliche Services und IPC-Handler aufteilen.*

- [ ] **2.1 Entry-Point vorbereiten**
  - Erstelle `src/main/index.js`, importiere dort zunächst noch keine verschobene Logik.
  - Dokumentiere im Code oder Plan, welche Initialisierung im Entry Point stattfinden muss: Permissions, Window, IPC-Handler.
  - `package.json` bleibt in diesem Schritt noch auf `"main": "main.js"`, damit kein Laufzeitverhalten geändert wird.
- [ ] **2.2 Window Management auslagern**
  - Erstelle `src/main/window.js`.
  - Verschiebe die `createWindow`-Funktion dorthin und exportiere sie.
  - Verwende beim Übergang weiterhin korrekte Root-Pfade:
    - Preload vor Phase 3: `path.join(projectRoot, 'preload.js')`
    - Renderer vor Phase 4: `path.join(projectRoot, 'renderer', 'index.html')`
  - Halte `app.on('activate')` / `app.on('window-all-closed')` im Entry Point oder in einem klar benannten Lifecycle-Modul. Nicht zwischen mehreren Dateien verteilen.
  - Stelle einen Zugriff auf das aktuelle Fenster bereit, z.B. `getMainWindow()`, damit Dialog-Handler kein globales `mainWindow` importieren müssen.
- [ ] **2.3 Permissions auslagern**
  - Erstelle optional `src/main/permissions.js`.
  - Verschiebe `session.defaultSession.setPermissionRequestHandler(...)` dorthin oder initialisiere ihn bewusst in `src/main/index.js`.
  - *Test:* Voice Input muss weiterhin Zugriff auf das Mikrofon erhalten.
- [ ] **2.4 Services extrahieren (Geschäftslogik)**
  - Erstelle `src/main/services/`.
  - Lege `storage-service.js` an (für `readLLMConfig`, `writeLLMConfig`, `readChatHistoryStore`, etc.).
  - Lege `fs-service.js` an (für `resolveWorkspacePath`, `runWorkspaceTool`, etc.).
  - Lege `whisper-service.js` an (für die Audio-Transkription).
  - Achte darauf, dass `safeStorage`, `fs`, `path` und Provider-Abhängigkeiten klar im jeweiligen Service importiert oder injiziert werden.
- [ ] **2.5 Provider verschieben**
  - Verschiebe den Ordner `providers/` nach `src/main/providers/`.
  - Passe die Import-Pfade in den Services an.
  - *Test:* Provider-Liste laden, Provider speichern, Model-Liste laden und einen Chat starten.
- [ ] **2.6 IPC-Handler separieren**
  - Erstelle `src/main/ipc/`.
  - Lege Dateien wie `fs-handlers.js`, `chat-handlers.js`, `settings-handlers.js` an.
  - Verschiebe die `ipcMain.handle(...)` Aufrufe in diese Dateien und verknüpfe sie mit den neuen Services.
  - Jeder Handler exportiert eine Registrierungsfunktion, z.B. `registerFsHandlers({ ipcMain, fsService })`.
  - Dialog-Handler erhalten `getMainWindow`, Chat-Handler erhalten Provider-/Storage-/Workspace-Services.
  - **Wichtig:** Handler dürfen keine Service-Factories selbst aufrufen (`require('../services/storage-service')()`). Alle Services werden einmalig in `src/main/index.js` erzeugt und an die Register-Funktionen übergeben (siehe Leitplanken).
  - *Test:* Nach jeder Handler-Datei die zugehörige Funktion manuell prüfen.
- [ ] **2.7 Chat-Kanäle prüfen**
  - Der bestehende Kanal `openai:chat` dispatcht inzwischen an mehrere Provider. Entscheide bewusst:
    - Entweder Kanalnamen zunächst beibehalten, um das Refactoring klein zu halten.
    - Oder kontrolliert auf generische Namen wie `chat:send`, `chat:delta`, `chat:tool-line`, `chat:progress` migrieren.
  - Falls Kanalnamen geändert werden, müssen `main`, `preload` und Renderer in einem kleinen, eigenen Schritt angepasst werden.
- [ ] **2.8 Neuen Entry Point aktivieren**
  - Importiere in `src/main/index.js` das Window-Management, Permissions und alle IPC-Handler-Registrierungen.
  - Ändere `"main": "main.js"` zu `"main": "src/main/index.js"`.
  - Lösche die alte `main.js` erst, wenn `npm run start` mit dem neuen Entry Point erfolgreich war.
  - *Test:* App starten. Alle Backend-Funktionen (Speichern, LLM-Aufrufe, Dateisystem) müssen funktionieren.

## Phase 3: Preload-Skript Migration
*Ziel: Das Preload-Skript an den neuen Ort verschieben und aufräumen.*

- [ ] **3.1 Preload verschieben & Window-Pfad anpassen (atomar)**
  - Verschiebe `preload.js` nach `src/preload/index.js`.
  - Passe **im selben Commit** in `src/main/window.js` den Pfad zum Preload-Skript an (`path.join(__dirname, '../preload/index.js')`).
  - Nur einer dieser beiden Schritte allein lässt die App nicht starten — daher zusammen abarbeiten und committen.
- [ ] **3.2 IPC-Kanäle nutzen**
  - Stelle sicher, dass `src/preload/index.js` die Konstanten aus `src/shared/ipc-channels.js` verwendet.
  - Belasse die public API `window.electronAPI` zunächst stabil, damit der Renderer nicht gleichzeitig refactored werden muss.
  - *Test:* App starten und prüfen, ob die `window.electronAPI` im Renderer korrekt geladen wird.

## Phase 4: Renderer-Prozess Modularisierung
*Ziel: Die 1.900 Zeilen lange `app.js` in ES-Module aufteilen.*

- [ ] **4.1 Renderer-Abhängigkeiten kartieren**
  - Markiere in `renderer/app.js` zuerst globale State-Variablen, DOM-Referenzen, Event-Listener und Funktionen mit Seiteneffekten.
  - Dokumentiere kurz, welche Funktionen voneinander abhängen, bevor Dateien verschoben werden.
  - Ziel ist eine Migrationsreihenfolge, nicht perfekte Architektur.
- [ ] **4.2 Renderer verschieben**
  - Verschiebe den **kompletten** Inhalt von `renderer/` nach `src/renderer/` — also `app.js`, `index.html`, `styles.css`, den `styles/`-Ordner und den `vendor/`-Ordner.
  - Passe in `src/main/window.js` den Pfad zur `index.html` an.
  - `<link>`- und `<script>`-Pfade in `index.html` sind relativ und sollten unverändert funktionieren — trotzdem nach dem Move einmal explizit verifizieren.
  - Passe `scripts/sync-renderer-vendor.js` auf `src/renderer/vendor/` an und führe danach einmal `npm run sync-vendor` aus, um den Pfad zu validieren. (`npm run start` würde alleine nicht auffallen, weil die Vendor-Dateien schon kopiert sind — der Fehler tauchte sonst erst beim nächsten `npm install` oder `npm run make` auf.)
  - *Test:* App starten, bevor ES-Module aktiviert oder Funktionen extrahiert werden.
- [ ] **4.3 ES-Module aktivieren**
  - Ändere in `src/renderer/index.html` den Skript-Tag zu `<script type="module" src="./app.js"></script>`.
  - Die Vendor-Skript-Tags (`marked`, `DOMPurify`) bleiben **unverändert** als klassische `<script>`-Tags vor dem Module-Skript stehen. Sie setzen `window.marked` / `window.DOMPurify` als Globals, und genau so werden sie aus dem Renderer-Code weiterhin gelesen. Kein Versuch, sie als ES-Module zu importieren — die ausgelieferten UMD-Builds sind dafür nicht gedacht.
  - *Test:* Renderer lädt ohne Console-Fehler, Markdown-Rendering im Chat funktioniert.
- [ ] **4.4 Utilities auslagern**
  - Erstelle `src/renderer/utils/helpers.js`.
  - Verschiebe Funktionen wie `isTextFile`, `getExtension`, `formatSize`, `markdownToSafeHtml`, `svgChevron`, `svgFolder`, `svgFile` dorthin und exportiere sie.
  - Beginne mit reinen Funktionen ohne DOM- oder State-Zugriff.
- [ ] **4.5 State Management auslagern**
  - Erstelle `src/renderer/state/store.js`.
  - Kapsele globale Variablen wie `llmState`, `chatMessages`, `rootPath`, `currentChatId` in einem exportierten Store-Objekt oder in Getter/Setter-Funktionen.
  - Migriere State schrittweise: erst lesen, dann schreiben, dann Events.
- [ ] **4.6 UI-Komponenten extrahieren (Schrittweise)**
  - Erstelle `src/renderer/components/`.
  - **Schritt 4.6.1: Theme & Layout** -> `ThemeManager.js`, `SidebarResizer.js`.
  - **Schritt 4.6.2: File Tree** -> `FileTree.js` (Logik für `loadTreeLevel`, Drag & Drop).
  - **Schritt 4.6.3: Settings Modal** -> `SettingsModal.js` (Logik für Provider-Auswahl, API-Keys, Model-Loading).
  - **Schritt 4.6.4: Chat Panel** -> `ChatPanel.js` (Logik für `renderChatMessages`, `sendChatMessage`, Streaming-Updates).
  - **Schritt 4.6.5: Voice Input** -> `VoiceInput.js` (Logik für MediaRecorder und Whisper).
  - Nach jedem Schritt darf nur die betroffene UI-Fläche geändert sein; keine parallelen Layout- oder Styling-Änderungen.
- [ ] **4.7 `app.js` als reinen Orchestrator umbauen**
  - Importiere alle Komponenten in `src/renderer/app.js`.
  - Initialisiere hier lediglich die Module und setze die initialen Events (z.B. `openProject` beim Start).
  - *Test:* Nach jedem Schritt aus 4.6 die UI im Browser testen.

## Phase 5: Abschluss & Build-Prüfung
*Ziel: Sicherstellen, dass die modularisierte App fehlerfrei gebaut und paketiert werden kann.*

- [ ] **5.1 Aufräumen**
  - Lösche alle verbleibenden Dateien im alten Root-Verzeichnis, die nun in `src/` liegen.
  - Prüfe auf ungenutzte Variablen oder tote Imports.
- [ ] **5.2 Build-Skripte anpassen**
  - Prüfe die Skripte in der `package.json` (z.B. `sync-renderer-vendor.js`).
  - Passe Pfade in `scripts/sync-renderer-vendor.js` an, falls diese noch auf den alten `renderer/`-Ordner zeigen (muss nun auf `src/renderer/vendor/` zeigen).
  - Passe die Forge-Konfiguration (`packagerConfig.ignore`) an, falls nötig. Aktuell wird nur `\\.venv` ignoriert — `.venv` liegt weiterhin im Root, daher kein Eingriff nötig. Falls Whisper lokal mit Python läuft, prüfen, dass Pfade vom `whisper-service.js` aus zum Python-Skript weiterhin korrekt aufgelöst werden (relativ zum Projektroot, nicht zu `src/main/services/`).
- [ ] **5.3 IPC-Inventur abgleichen**
  - Vergleiche die in Phase 0.2 erstellte Liste der IPC-Kanäle mit dem aktuellen Stand. Jeder ursprüngliche Kanal muss entweder unverändert existieren oder ein klares Mapping zu seinem neuen Namen haben.
- [ ] **5.4 Finaler Test & Package**
  - Führe `npm run start` aus und teste alle Kernfunktionen (Chat, Dateibaum, Settings, Drag&Drop).
  - Teste zusätzlich Voice Input, zuletzt geöffnete Ordner, Chat-Historie, Provider-Wechsel und Model-Loading.
  - Verifiziere, dass die Persistenz-Dateien aus Phase 0.3 unverändert weitergelesen werden — also dass ein vor dem Refactoring gespeicherter API-Key und eine bestehende Chat-Historie nach dem Refactoring noch da sind.
  - Führe `npm run make` aus, um sicherzustellen, dass der Electron-Forge Build-Prozess mit der neuen Struktur erfolgreich durchläuft.

---

## Anhang A: IPC-Inventur (Stand vor Refactoring)

Quelle: `main.js`, `preload.js`. Diese Liste ist die Diff-Checkliste für Phase 5.3 — jeder Kanal muss nach dem Refactoring entweder unverändert existieren oder ein dokumentiertes Mapping haben.

### A.1 Request/Response (`ipcMain.handle` ↔ `ipcRenderer.invoke`)

| Kanal | Main-Handler | Preload-API (`window.electronAPI.*`) |
| --- | --- | --- |
| `dialog:openFolder` | `main.js` | `openFolder()` |
| `fs:readDirectory` | `main.js` | `readDirectory(dirPath)` |
| `fs:readFile` | `main.js` | `readFile(filePath)` |
| `fs:moveItem` | `main.js` | `moveItem(sourcePath, destDir)` |
| `settings:getLLMState` | `main.js` | `getLLMState()` |
| `settings:setProvider` | `main.js` | `setProvider(payload)` |
| `settings:clearProvider` | `main.js` | `clearProvider(providerId)` |
| `settings:setActiveProvider` | `main.js` | `setActiveProvider(providerId)` |
| `settings:listModels` | `main.js` | `listModels(payload)` |
| `settings:getLastFolder` | `main.js` | `getLastFolder()` |
| `settings:setLastFolder` | `main.js` | `setLastFolder(folderPath)` |
| `settings:getFolderHistory` | `main.js` | `getFolderHistory()` |
| `settings:getUIPrefs` | `main.js` | `getUIPrefs()` |
| `settings:setUIPrefs` | `main.js` | `setUIPrefs(partial)` |
| `chatHistory:get` | `main.js` | `getChatHistory(workspaceRoot)` |
| `chatHistory:upsert` | `main.js` | `upsertChatSession(session)` |
| `chatHistory:delete` | `main.js` | `deleteChatSession(id)` |
| `chatHistory:setActive` | `main.js` | `setActiveChatId(workspaceRoot, id)` |
| `openai:chat` | `main.js` | `chat(messages, options)` |
| `whisper:transcribe` | `main.js` | `transcribeAudio(audioBuffer)` |

### A.2 Push-Kanäle (`webContents.send` → `ipcRenderer.on`)

Diese Kanäle werden **nicht** über `invoke` gerufen, sondern aktiv vom Main an den Renderer gepusht. Beim Refactoring leicht zu übersehen.

| Kanal | Main-Sender | Preload-Subscriber |
| --- | --- | --- |
| `openai:chat:delta` | `main.js` (Streaming-Callback) | `onChatDelta(callback) → unsubscribe` |
| `openai:chat:tool-line` | `main.js` (Tool-Use-Loop) | `onChatToolLine(callback) → unsubscribe` |
| `openai:chat:progress` | `main.js` (Phase / Reasoning) | `onChatProgress(callback) → unsubscribe` |

Hinweis: Die Preload-Wrapper geben jeweils eine `unsubscribe`-Funktion zurück, die den `ipcRenderer.removeListener`-Aufruf macht. Dieses Verhalten muss erhalten bleiben, sonst leakt der Renderer Listener bei jedem Chat-Send.

### A.3 Sonstige Bridge-APIs

Über `contextBridge.exposeInMainWorld('electronAPI', …)` ist zusätzlich freigegeben (kein eigener IPC-Kanal, aber Teil der Renderer-API):

- `openExternal(url)` — direkt im Preload, ruft `shell.openExternal` mit Whitelist auf `http(s)`.

---

## Anhang B: Persistenz-Inventur (Stand vor Refactoring)

Alle Dateien liegen unter `app.getPath('userData')` (siehe `main.js`). Format und Schlüssel **dürfen sich beim Refactoring nicht ändern**, sonst verlieren bestehende Nutzer ihre Daten.

| Datei | Konstante in `main.js` | Inhalt | Verschlüsselt? |
| --- | --- | --- | --- |
| `llm-config.json` | `LLM_CONFIG_FILENAME` | `{ version: 2, activeProvider, providers: { <id>: { apiKeyEnc?, baseUrl?, model } } }` | `providers[*].apiKeyEnc` ist `safeStorage.encryptString(...).toString('base64')` |
| `openai-config.json` | `LEGACY_OPENAI_CONFIG_FILENAME` | **Legacy:** `{ apiKeyEnc, model }` aus der Single-Provider-Ära. Wird beim ersten Lesen automatisch in `llm-config.json` migriert (`readLLMConfig`). Datei selbst bleibt liegen. | `apiKeyEnc` wie oben |
| `last-folder.json` | `LAST_FOLDER_FILENAME` | `{ path: string }` — zuletzt geöffneter Ordner | nein |
| `folder-history.json` | `FOLDER_HISTORY_FILENAME` | `{ paths: string[] }` — max. `MAX_FOLDER_HISTORY` (10) | nein |
| `ui-preferences.json` | `UI_PREFS_FILENAME` | `{ contentPaneVisible: boolean }` | nein |
| `chat-history.json` | `CHAT_HISTORY_FILENAME` | `{ version: 2, activeByWorkspace: { [wsKey]: id }, sessions: [{ id, workspaceRoot, title, updatedAt, messages }] }`; max. `MAX_CHAT_SESSIONS` (200). Workspace-Schlüssel `__none__` für globale Sessions ohne Ordner. | nein |

**Worauf Phase 5.4 achten muss:**

- Ein vor dem Refactoring gespeicherter API-Key muss nach dem Refactoring weiterhin entschlüsselbar sein. `safeStorage` ist OS-gebunden — als simpelster Test eine bestehende `llm-config.json` einmal vorher lesen, dann nach dem Refactoring `settings:getLLMState` im Renderer prüfen (`hasKey: true`).
- `chat-history.json` Version 2 muss weitergelesen werden, inklusive `activeByWorkspace`-Map.
- Die Legacy-Migrations­routine darf nicht doppelt laufen oder verlorengehen — sonst wird ein Nutzer mit nur `openai-config.json` "leer" gestartet.
- Persistenz-Schlüssel und Sentinel-Werte (`NO_WORKSPACE_KEY = '__none__'`, `version: 2`) bleiben Konstanten — beim Verschieben in `storage-service.js` als gleiche Strings übernehmen.
