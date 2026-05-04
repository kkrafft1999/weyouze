# Code Review – Weyouze Anything

- **Datum:** 2026-05-03
- **Branch / Commit:** `main` @ `d35055e`
- **Umfang:** `src/` (8 638 LOC, ohne `vendor/`), `package.json`, `scripts/`, `.gitignore`
- **Stack:** Electron 41, ES Modules im Renderer, CommonJS im Main, kein TypeScript, keine Tests

Die App ist sauber strukturiert (Main/Preload/Renderer klar getrennt, IPC zentral typisiert in `src/shared/ipc-channels.js`, Provider als austauschbare Module). Die größten Schwachpunkte liegen bei drei Themen: **(a)** unvollständige Electron‑Härtung, **(b)** offene Sanitizer‑Konfiguration für LLM‑Markdown, **(c)** ein 2 227‑Zeilen‑Renderer‑Monolith.

---

## Priorisierung – Übersicht

| #  | Schwere   | Bereich       | Befund                                                                                       |
|----|-----------|---------------|----------------------------------------------------------------------------------------------|
| 1  | Hoch      | Electron      | `sandbox: false` im Renderer trotz aktiver `contextIsolation`                                 |
| 2  | Hoch      | Electron      | Keine Navigation-/Window-Open-Guards (`will-navigate`, `setWindowOpenHandler`)                 |
| 3  | Hoch      | XSS           | `DOMPurify`-Konfiguration zu schwach (kein `target`/`rel`-Hardening, keine URI-Whitelist)      |
| 4  | Hoch      | IPC           | `fs:readDirectory`, `fs:readFile`, `fs:moveItem` ohne Workspace-Bindung                        |
| 5  | Hoch      | CSP           | CSP erlaubt `style-src 'unsafe-inline'`, kein `connect-src`/`img-src`/`script-src`             |
| 6  | Mittel    | Daten         | `chat-history.json` enthält ganze Tool-Outputs / Reasoning unverschlüsselt                     |
| 7  | Mittel    | TLS           | Globaler `Insecure-Dispatcher` in Ollama bleibt Prozess-Lifetime erhalten                      |
| 8  | Mittel    | Atomicity     | Keine atomaren Writes (`writeFile` ohne tmp-rename) für `llm-config`, `chat-history`           |
| 9  | Mittel    | Wartbarkeit   | `src/renderer/app.js` mit 2 227 Zeilen — Tree, Chat, Settings, IPC, Voice in einer Datei       |
| 10 | Mittel    | Robustheit    | Race-Conditions im Chat-History-Store (`read–modify–write` ohne Lock)                          |
| 11 | Niedrig   | UX/A11y       | `ResizeObserver` ohne `disconnect()`; `input`-Listener ohne Debounce                           |
| 12 | Niedrig   | Provider      | Whisper hartkodiert Sprache `de`, Modell `whisper-1`; keine Konfigurierbarkeit                 |
| 13 | Niedrig   | Build         | `package.json` hat keinen `engines`-Block, kein Lint-/Test-Script                              |
| 14 | Niedrig   | Code-Stil     | `safeJsonParse` 3× dupliziert; magische Limits hartkodiert                                     |

---

## Hoch — Sicherheit & Architektur

### 1. Electron-Sandbox ist abgeschaltet (`src/main/window.js:18`)

```js
webPreferences: {
  preload: …,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,           // ← Renderer hat im Worst-Case Node-API-Zugriff über Bug-Chains
}
```

Mit `sandbox: false` läuft der Renderer-Prozess **nicht** im OS-Sandbox-Process; eine Renderer-Compromise (z. B. über bösartig generiertes Markdown im LLM-Stream) kann mit V8-Escape direkt Node-Primitives ausführen. `contextIsolation: true` schützt nur die `window`-Brücke, nicht den Prozess selbst. Da der Preload selbst keinen Node-Code braucht (nur `contextBridge` + `ipcRenderer`), ist `sandbox: true` problemlos aktivierbar.

**Fix:** `sandbox: true` setzen und prüfen, dass der Preload weiterhin lädt. Die offizielle Electron-Empfehlung ist „enabled by default“.

---

### 2. Keine Navigation-/Window-Open-Guards (`src/main/window.js`)

Das Fenster registriert weder `will-navigate` noch `setWindowOpenHandler`. Klickt der Nutzer auf einen Link in einem LLM-Output (oder ein bösartiger LLM injiziert ein `<a target="_blank">…`), öffnet Electron je nach Code‑Pfad ein neues `BrowserWindow` mit denselben `webPreferences` — ein bekannter Privilege-Escalation‑Vektor.

**Fix** in `createWindow`:

```js
window.webContents.setWindowOpenHandler(({ url }) => {
  const u = new URL(url);
  if (u.protocol === 'http:' || u.protocol === 'https:') shell.openExternal(url);
  return { action: 'deny' };
});
window.webContents.on('will-navigate', (e, url) => {
  if (!url.startsWith('file://')) e.preventDefault();
});
```

Aktuell wird `api.openExternal` zwar im Renderer aufgerufen (`app.js:1429`), aber der `<a>`-Click-Handler greift nur, wenn `href` auf `http(s)://` startet — Schemata wie `file://`, `data:` oder `javascript:` werden weiter an das Browser-Default delegiert.

---

### 3. DOMPurify zu liberal (`src/renderer/utils/helpers.js:39`)

```js
return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
```

Der LLM-Output ist **untrusted** (Prompt-Injection via Tool-Output, Dateiinhalt, Web-Suche). Aktuell:

- Keine Whitelist für Link-Schemata → `data:text/html,…`, `vbscript:`, `javascript:` werden je nach DOMPurify-Version geblockt, aber **`mailto:`, `file:`, `sms:` bleiben offen**.
- Keine forced `target="_blank"` + `rel="noopener noreferrer"` — Tabnabbing möglich, falls in Zukunft `BrowserWindow`-Öffnen erlaubt wird.
- `<form>`, `<iframe>` (in HTML-Profile streng genommen geblockt, aber besser explizit forbidden).

**Fix:**

```js
const ALLOWED_PROTOS = /^(https?|mailto):/i;
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
    const href = node.getAttribute('href') || '';
    if (!ALLOWED_PROTOS.test(href)) node.removeAttribute('href');
  }
});
return DOMPurify.sanitize(html, {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['style', 'iframe', 'form'],
  FORBID_ATTR: ['style', 'srcset'],
});
```

Zusätzlich: in `index.html:6` ist `style-src 'unsafe-inline'` aktiv — ein bösartiges `<style>` durchs Markdown wäre beim aktuellen Sanitizer-Profil zwar geblockt, aber siehe Punkt 5.

---

### 4. IPC-FS-Endpoints ohne Workspace-Bindung (`src/main/ipc/fs-handlers.js`)

```js
ipcMain.handle(REQ.FS_READ_FILE, async (_event, filePath) => {
  return await fsService.readFilePreview(filePath);   // ← absoluter Pfad, ungeprüft
});
ipcMain.handle(REQ.FS_MOVE_ITEM, async (_event, sourcePath, destDir) => { … });
ipcMain.handle(REQ.FS_READ_DIRECTORY, async (_event, dirPath) => { … });
```

Anders als die LLM-Tools (`runWorkspaceTool` mit `resolveWorkspacePath`) prüfen diese Handler **nicht**, ob der Pfad innerhalb des aktuell geöffneten Ordners liegt. Argumentativ sieht es so aus, als sei der Renderer „vertrauenswürdig“, aber:

- Eine Renderer-Compromise (siehe #1, #3) kann beliebige Dateien lesen / verschieben.
- `moveItem` hat keine Größenbeschränkung und kein „nicht aus `~/`“-Check.

**Fix:** Den aktiven Workspace im Main-Prozess als Single-Source-of-Truth halten (z. B. in `storage` über `setActiveWorkspace`) und alle FS-Handler über `fsService.resolveWorkspacePath` validieren — exakt wie `runWorkspaceTool`. Falls Read außerhalb gewollt ist (z. B. „Ordner-Wechsel-Vorschau“), einen separaten, expliziten Channel mit Dialog-Bestätigung nutzen.

---

### 5. Content-Security-Policy ist unvollständig (`src/renderer/index.html:6`)

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' blob:;">
```

- Kein **`connect-src`** → ein injizierter `fetch()` aus dem Renderer könnte zu beliebigen Hosts gehen. Der Renderer braucht eigentlich gar kein direktes Netzwerk (alle API-Calls laufen über IPC im Main).
- Kein **`script-src`** → fällt auf `default-src 'self'` zurück (gut), aber explizit setzen ist robuster gegen versehentliche `default-src`-Änderungen.
- Kein **`img-src`** → Markdown mit `<img src="https://attacker/..">` lädt remote Pixel (Tracking).
- `style-src 'unsafe-inline'` ist nötig für die Inline-`hidden`-Klasse usw., aber besser via Klassen.

**Fix:**

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  font-src 'self';
  img-src 'self' data:;
  media-src 'self' blob:;
  connect-src 'none';
  base-uri 'none';
  form-action 'none';
  frame-ancestors 'none';
">
```

---

## Mittel — Daten, Robustheit, Architektur

### 6. Sensitive Daten unverschlüsselt in `chat-history.json` (`src/main/services/storage-service.js:381`)

```js
await fs.writeFile(getChatHistoryPath(), JSON.stringify(store), 'utf8');
```

Der Chat-Verlauf enthält:
- **Volle Inhalte** der Konversation (User-Prompts, LLM-Antworten, Reasoning).
- Tool-Outputs mit Dateiinhalten — also potenziell Source-Code, `.env`-Inhalte, Zugangsdaten, die der LLM via `read_file_text` gesehen hat.

API-Keys werden korrekt mit `safeStorage.encryptString` verschlüsselt (`storage-service.js:122`), aber der semantisch sensiblere Chat-Verlauf liegt im Klartext in `~/Library/Application Support/Weyouze Anything/chat-history.json`.

**Empfehlung:** Mindestens dokumentieren („Chat-Verlauf wird unverschlüsselt gespeichert“), idealerweise per `safeStorage.encryptString` ganzen Store verschlüsseln, mit Plaintext-Fallback bei `safeStorage.isEncryptionAvailable() === false`.

---

### 7. Globaler Insecure-Dispatcher in Ollama (`src/main/providers/ollama.js:11`)

```js
let _insecureDispatcher = null;
function getInsecureDispatcher() {
  if (!_insecureDispatcher) {
    _insecureDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  }
  return _insecureDispatcher;
}
```

Einmal angelegt bleibt der Dispatcher für die Prozess-Lebensdauer im Speicher — auch wenn der Nutzer den Insecure-Schalter wieder ausmacht. Wechselt er den Server zu einem mit gültigem Zertifikat, ist das egal (kein Funktionsproblem), aber:

- Der Dispatcher wird in `dispatcherFor()` **erst dann** verwendet, wenn `config.insecureTls === true`, also kein Bypass-Risiko bei toggle off.
- Aber: kein `destroy()` beim App-Quit → minimaler Leak; kein Logging, dass eine Verbindung über Insecure-Pfad lief. Ein Log/Telemetrie-Hook („Insecure-TLS für `https://…` aktiv“) würde Debugging und Audit erleichtern.

---

### 8. Keine atomaren JSON-Writes (`storage-service.js:184, 291, 381, 396, 418`)

```js
await fs.writeFile(getLLMConfigPath(), JSON.stringify(config), 'utf8');
```

Wird die App während `writeFile` hart beendet (Crash, Strom weg, Dock-„Sofort beenden“), bleibt eine **leere oder halb geschriebene Datei** liegen. Der nächste Start fällt auf `defaultLLMConfig()` / leere History zurück und der **API-Key ist verloren**.

**Fix:** Helper

```js
async function writeJsonAtomic(target, data) {
  const tmp = `${target}.tmp-${process.pid}`;
  await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
  await fs.rename(tmp, target);
}
```

…und alle 5 Writes durchschleusen. Auf macOS ist `rename()` atomar.

---

### 9. `src/renderer/app.js` mit 2 227 Zeilen ist die größte Wartbarkeits-Schuld

In einer Datei: Tree-Rendering, Chat-UI, Settings-Modal, History-Drawer, Voice-Input, IPC-Subscriptions, State-Mutations. Konkret refactorierbare Schnittachsen:

| Zeilen          | Verantwortung           | Vorschlag                                         |
|-----------------|-------------------------|---------------------------------------------------|
| ≈ 260–600       | Tree                    | `components/FileTree.js` (existiert mit 11 Z. — leer) |
| ≈ 900–1 000     | Chat-Verlauf-Drawer     | `components/ChatHistoryDrawer.js`                 |
| ≈ 1 070–1 220   | Modell-Picker           | `components/ChatModelPicker.js`                   |
| ≈ 1 350–1 530   | Chat-Stream + Render    | `components/ChatStream.js`                        |
| ≈ 1 590–2 000   | Settings + Add-Model    | `components/SettingsModal.js`                     |
| ≈ 700–880       | Voice/Whisper           | `voice/WhisperRecorder.js`                        |

`components/FileTree.js` und `components/SidebarResizer.js` zeigen, dass das Modul-Pattern bereits etabliert ist — `FileTree.js` ist allerdings nur ein 11-Zeilen-Stub (`src/renderer/components/FileTree.js:1`).

---

### 10. Race-Conditions im Chat-History-Upsert (`src/main/ipc/chat-history-handlers.js:10`)

```js
const store = await storage.readChatHistoryStore();    // read
…
store.sessions[idx] = normalized;                       // modify
await storage.writeChatHistoryStore(store);             // write
```

Wenn der Renderer parallel zwei `chatHistory:upsert` schickt (z. B. zwei tabs/zwei Streams beenden gleichzeitig), wird der zweite den ersten überschreiben. In dieser App selten, aber bei aktiver Streaming-Logik durchaus möglich, weil pro Token ein Upsert getriggert werden könnte.

**Fix:** Eine simple Promise-Chain als Mutex:

```js
let writeQueue = Promise.resolve();
function withLock(fn) { writeQueue = writeQueue.then(fn, fn); return writeQueue; }
```

…und `read–modify–write` durch `withLock` umschließen.

---

## Niedrig — Kleinkram, der den Code aufräumt

### 11. ResizeObserver / Input-Listener ohne Cleanup oder Debounce (`src/renderer/app.js:112–117`)

`ResizeObserver` wird beim Init erzeugt und nie disconnected; `chatInput`-`input`-Listener ohne Debounce → bei Tippen fließt jedes Zeichen durch `syncChatInputHeight()`. Visuell unkritisch, aber unnötiger Reflow. `requestAnimationFrame`-Throttle reicht.

### 12. Whisper-Konfiguration hartkodiert (`src/main/services/whisper-service.js:13–17`)

```js
…name="model"\r\n\r\nwhisper-1\r\n
…name="language"\r\n\r\nde\r\n
```

Modell und Sprache stecken im Body-String. Ein einziger `language`-Switch in den UI-Prefs würde Mehrsprachigkeit erlauben (`appLocale` ist schon da, wird aber für Whisper nicht durchgereicht).

### 13. `package.json` ohne Lint/Test/Engines

```json
"scripts": {
  "sync-vendor": "…",
  "start": "…",
  "package": "…",
  "make": "…"
}
```

Es fehlen `lint`, `test`, `engines`. Ohne Tests ist jede Änderung an `chat-handlers.js` (komplexe Tool-Loop-Logik) Hochrisiko. Mindestens ein paar Unit-Tests für `resolveWorkspacePath`, `translateMessagesToAnthropic`/`…ToGoogle`/`…ToOllama`, `normalizePresetEntry`, `migrateLLMConfigToV3` wären hochwertig — alles reine Funktionen.

### 14. Code-Duplikate

- `safeJsonParse` ist in `google.js:84` und `ollama.js:62` identisch — gehört in `stream-helpers.js`.
- `isLikelyJsonString` (`anthropic.js:52`) ist Symptom dafür, dass die LLM-API einmal valides JSON, einmal Schrott liefert; dokumentieren oder zentralisieren.
- `MAX_READ_FILE_BYTES`, `MAX_CHAT_SESSIONS`, `MAX_FOLDER_HISTORY`, `MAX_TOOL_ROUNDS` werden alle in `index.js` als Konstanten gesetzt und einzeln durch die Factories durchgereicht — ein `config.js`-Modul wäre kompakter.
- `chat-handlers.js:115–128` und `fs-service.js:4–13` lösen dasselbe Problem (Path-Bounds-Check) leicht unterschiedlich. Eine gemeinsame Helper-Funktion wäre robuster.

### 15. Kleine Korrektheits-Glitches

- `chat-handlers.js:99`: `providerConfig.reasoningEffort = chatTarget.reasoningEffort;` mutiert das Objekt, das aus `getEffectiveProviderConfig` kommt — funktional ok, aber Mutation eines „pure“-Returns ist überraschend. Lieber `{ ...providerConfig, reasoningEffort }` weiterreichen.
- `storage-service.js:191`: `if (!safeStorage.isEncryptionAvailable()) return null;` — dadurch verschwindet der API-Key beim Provider-Modal **stillschweigend**, wenn z. B. macOS Keychain temporär nicht antwortet. Mindestens loggen.
- `anthropic.js:105`: Tool-IDs werden mit `Math.random()` befüllt, falls leer — sollte nicht passieren, aber ein erkennbares Prefix wäre besser für Debugging als `tu_3jx7…`.
- `ollama.js:167`: Tool-Call-IDs `ocall_…_${Date.now()}` — kollidieren bei zwei Calls in derselben ms; besser `randomUUID()`.

### 16. `defaultModel` für Anthropic veraltet (`src/main/providers/anthropic.js:245`)

```js
defaultModel: 'claude-3-5-sonnet-latest',
```

Stand 2026-05 ist die aktuelle Familie Claude 4.x; `claude-sonnet-4-6` oder `claude-haiku-4-5-20251001` ist sinnvoller als Default. (Gleiches gilt für die Liste der Filter-Patterns in `openai.js:30` — die Blacklist `whisper|tts|embedding|dall-e|moderation|davinci|babbage|curie|^ada` lässt neue, noch nicht gefilterte Hilfs-Modelle einfach durch.)

### 17. `permissions.js` lehnt nicht-Mikrofon-Permissions ab (`src/main/permissions.js:13`)

Sauber — keine Beanstandung. Anmerkung: `notifications` und `clipboard-read` werden ebenfalls verweigert, was für einen LLM-Client passend ist.

---

## Stichpunktartig: was ist gut

- IPC-Channels zentral und readonly per `Object.freeze` (`src/shared/ipc-channels.js`).
- Path-Traversal-Schutz für die LLM-Tools korrekt implementiert (`src/main/services/fs-service.js:4`).
- `safeStorage` für API-Keys und Migrationspfad v2 → v3 sauber gelöst (`storage-service.js:94`).
- DOMPurify ist überhaupt eingebunden — viele Electron-Apps machen `marked.parse()` direkt in `innerHTML`.
- IPC-Subscriptions im Renderer werden im `try/finally` korrekt unsubscribed (`app.js:1455 ff.`).
- Provider-Module einheitliche Schnittstelle (`streamChatRound`, `listModels`, `fields`-Meta).
- Workspace-bezogene Tool-Loop mit harter Round-Begrenzung (`MAX_TOOL_ROUNDS = 14`, `chat-handlers.js:169`).
- Migration-Pfad in `chat-history.json` (Version 2) und `llm-config.json` (Version 2 → 3) ist defensiv.

---

## Vorgeschlagene Reihenfolge fürs Abarbeiten

1. **Sofort (1–3 h):** Sandbox einschalten (#1), `setWindowOpenHandler` + `will-navigate` (#2), CSP härten (#5), DOMPurify-Hook (#3) — alles Patches < 50 Zeilen.
2. **Diese Woche (½ Tag):** FS-Handler an Workspace binden (#4), atomare Writes (#8), Tests für reine Funktionen (#13).
3. **Nächster Sprint:** `app.js` aufteilen (#9), Chat-Mutex (#10), Chat-Verlauf optional verschlüsseln (#6).
4. **Nice-to-have:** Whisper-Sprache aus `appLocale` (#12), Code-Duplikate konsolidieren (#14), Default-Modelle aktualisieren (#16).
