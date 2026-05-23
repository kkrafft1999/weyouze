# Code Review – Weyouze Anything

- **Datum:** 2026-05-23
- **Branch / Commit:** `main` @ `a966c1a`
- **Umfang:** `src/` (Main, Preload, Renderer, Shared), `test/`, `scripts/`, `package.json`, `.gitignore`
- **Stack:** Electron 41, ES Modules im Renderer, CommonJS im Main, kein TypeScript, `node:test` (22/22 grün)

Verglichen mit dem Review vom 2026-05-03 sind die größten Hochpunkte (Sandbox, Navigation-Guards, DOMPurify-Hardening, Workspace-Bindung der FS-IPC-Channels, atomare Writes, Renderer-Modularisierung, Chat-History-Lock) **abgearbeitet**. Die jetzigen Findings betreffen **Concurrency-Restlöcher**, **fehlende Cancel-/UX-Hebel**, **toten Code aus der Refactoring-Welle** und **Provider-Edge-Cases**.

---

## Priorisierung – Übersicht

| #   | Schwere       | Bereich     | Befund                                                                          |
| --- | ------------- | ----------- | ------------------------------------------------------------------------------- |
| W1  | Wichtig       | Concurrency | `writeLLMConfig` und `writeUIPrefs` ohne Lock — Settings-Race möglich           |
| W2  | Wichtig       | Concurrency | Plaintext-→-Encrypted-Migration in `readChatHistoryStore` außerhalb des Locks   |
| W3  | Wichtig       | Sicherheit  | API-Key kann über UI nicht aktiv gelöscht werden                                |
| W4  | Wichtig       | Hygiene     | IPC-Channels heißen weiter `openai:chat*` trotz Multi-Provider                  |
| W5  | Wichtig       | UX          | Kein Cancel/Abort für laufende Chat-Requests                                    |
| W6  | Wichtig       | Sicherheit  | `setPermissionRequestHandler` prüft Origin/Renderer-URL nicht                   |
| M1  | Mittelwichtig | Dead Code   | `setActiveProvider` und `setProvider` sind end-to-end ungenutzt                 |
| M2  | Mittelwichtig | UX          | Sidebar- und Chat-Panel-Breite werden nicht persistiert                         |
| M3  | Mittelwichtig | Provider    | Fehlerdiagnose nur in `ollama.js` ausgebaut; andere Provider melden generisch   |
| M4  | Mittelwichtig | LLM         | Keine Trim-/Truncation-Strategie für lange Chat-Historien                       |
| M5  | Mittelwichtig | Architektur | Dynamic `require('./providers/ollama')` im `will-quit`-Handler                  |
| M6  | Mittelwichtig | Provider    | Anthropic akzeptiert leere `tool_use_id` und scheitert dann remote              |
| M7  | Mittelwichtig | Provider    | Google: `MALFORMED_FUNCTION_CALL` als `tool_calls` interpretiert                |
| M8  | Mittelwichtig | Tests       | Stream-Loops & IPC-Handler ungetestet; Translations-Tests gut                   |
| M9  | Mittelwichtig | Code        | `assertAbsolutePathInWorkspace` fährt Umweg über relative Pfade                 |
| M10 | Mittelwichtig | Architektur | Mutierter `appStore`-Singleton wird quer durch Components gelesen/geschrieben   |
| G1  | Niedrig       | Code        | Drei separate Outside-Click-Handler ohne gemeinsamen Helper                     |
| G2  | Niedrig       | Texte       | Mischung deutscher/ASCII-Anführungszeichen im System-Prompt                     |
| G3  | Niedrig       | Config      | `MAX_FOLDER_HISTORY` / `MAX_CHAT_SESSIONS` hartkodiert in `index.js`            |
| G4  | Niedrig       | Tools       | `read_file_text`-Description erwähnt 2-MB-Größenlimit nicht                     |
| G5  | Niedrig       | i18n        | `summarizeToolCall` lokalisiert im Main, nicht im Renderer                      |
| G6  | Niedrig       | Code        | `chatTitleEl.removeAttribute('lang')` doppelt in beiden if/else-Branches        |
| G7  | Niedrig       | Provider    | `bareModelId` ohne Validierung des User-Inputs                                  |
| G8  | Niedrig       | Streaming   | `iterStreamLines` flusht den `TextDecoder` am Ende nicht                        |
| G9  | Niedrig       | Renderer    | RAF-ID `streamRenderRaf` lebt im globalen `appStore` statt im Component-Scope   |
| G10 | Niedrig       | DX          | Keine JSDoc-Typedefs für die Provider-Adapter-Kontrakte                         |
| G11 | Niedrig       | Doku        | README beschreibt veraltete Top-Level-Struktur (`main.js`, `preload.js`, …)     |
| G12 | Niedrig       | Provider    | `safeJsonParse`-Fallback in `google.js` verpackt Tool-Output in `{ result }`    |

---

## Wichtig — Sicherheit / Korrektheit / Datenverlust

### W1 — Atomic Write & Concurrency-Lücke bei Settings/UI-Prefs

`writeJsonAtomic` wird genutzt, aber **nur `chat-history` läuft durch `withChatHistoryLock`**. `writeLLMConfig` und `writeUIPrefs` haben keinen Lock — schnelle Folgeaufrufe (z. B. `commitSettings` + Locale-Wechsel kurz danach) können sich gegenseitig überschreiben. Zusätzlich ist der tmp-Name `${pid}-${Date.now()}` nicht eindeutig, wenn mehrere Writes derselben Datei in derselben Millisekunde laufen.

```204:206:src/main/services/storage-service.js
  async function writeLLMConfig(config) {
    await writeJsonAtomic(getLLMConfigPath(), config);
  }
```

- [ ] Generischen `withFileLock(targetPath, fn)` einführen
- [ ] `writeLLMConfig` und `writeUIPrefs` durch den Lock leiten
- [ ] tmp-Name auf `randomUUID()` umstellen

### W2 — Encryption-Migration ohne Lock

Beim ersten Lesen wird Plaintext-Verlauf nach Encrypted migriert. Das passiert **außerhalb** von `withChatHistoryLock`, sodass parallele Reads + Writes inkonsistente Disk-States erzeugen können.

```426:428:src/main/services/storage-service.js
      if (safeStorage.isEncryptionAvailable() && !wasEncrypted) {
        await writeChatHistoryStore(store);
      }
```

- [ ] Migrationsschreib-Pfad in `withChatHistoryLock` wrappen oder über `firstReadDone`-Flag synchronisieren
- [ ] Test ergänzen, der parallele Reads während Migration simuliert

### W3 — API-Key kann nicht über die UI gelöscht werden

`mergeProviderPatchIntoConfig` und `setProvider` schreiben einen neuen Key nur, **wenn `apiKey` nicht-leer** ist. Es gibt keinen Pfad, einen alten `apiKeyEnc` aktiv zu entfernen — ohne manuellen File-Edit bleibt ein revoke'ter Schlüssel im verschlüsselten Speicher liegen.

```117:124:src/main/ipc/settings-handlers.js
    if (provider.fields?.apiKey) {
      const incomingKey = typeof patch?.apiKey === 'string' ? patch.apiKey.trim() : '';
      if (incomingKey) {
        if (!safeStorage.isEncryptionAvailable()) {
          return { ok: false, error: 'Verschlüsselter Speicher ist nicht verfügbar.' };
        }
        next.apiKeyEnc = safeStorage.encryptString(incomingKey).toString('base64');
      }
    }
```

- [ ] Explizites "Key entfernen"-Signal definieren (z. B. `apiKey === null` oder `removeApiKey: true`)
- [ ] Im Handler `delete next.apiKeyEnc` ausführen
- [ ] Trash-Button im Settings-Modal neben dem Key-Feld

### W4 — IPC-Channels tragen alten Provider-Namen

Push- und Send-Channels heißen weiterhin `openai:chat`, `openai:chat:delta`, `openai:chat:tool-line`, `openai:chat:progress`, obwohl alle Provider sie nutzen.

```45:49:src/shared/ipc-channels.js
const PUSH_CHANNELS = Object.freeze({
  CHAT_DELTA: 'openai:chat:delta',
  CHAT_TOOL_LINE: 'openai:chat:tool-line',
  CHAT_PROGRESS: 'openai:chat:progress',
});
```

- [ ] Auf `chat:send`, `chat:delta`, `chat:tool-line`, `chat:progress` umbenennen
- [ ] `preload/index.js` + Vendor-Bundle regenerieren (`npm run sync-vendor`)

### W5 — Kein Cancel/Abort für laufende Chat-Requests

Sobald `api.chat()` läuft, kann der User es bis Ende oder Fehler nicht abbrechen — kein UI-Stopp-Button, kein IPC-Abort. Bei einem hängenden lokalen Ollama oder einer langen Tool-Schleife frustrierend.

- [ ] `AbortController` im Renderer einführen, Stopp-Button im Chat-Input
- [ ] Neuen Push-Channel `chat:abort` (ipcRenderer.send → ipcMain.on)
- [ ] In `chat-handlers.js` Round-Loop bricht bei Abort-Signal ab und cancelt den Reader im Provider
- [ ] Provider-Adapter erhalten optionalen `abortSignal` und übergeben ihn an `fetch()`

### W6 — `setPermissionRequestHandler` prüft Origin/Renderer-URL nicht

```7:15:src/main/permissions.js
function registerMediaCapturePermissions(browserSession = session.defaultSession) {
  browserSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'audioCapture') {
      callback(true);
      return;
    }
    callback(false);
  });
}
```

CSP + `will-navigate` blockieren externe Origins, aber als Defense-in-Depth sollte hier explizit auf den eigenen Renderer eingegrenzt werden.

- [ ] `webContents.getURL()` prüfen und nur erlauben, wenn `file://`-Renderer mit erwartetem Pfad
- [ ] Test/Manual-Check, dass externes iframe (falls jemals zugelassen) keine Mic-Permission bekommt

---

## Mittelwichtig — Architektur / Konsistenz / UX

### M1 — Toter IPC-Code: `setActiveProvider` und `setProvider`

Beide sind in `preload/index.js` exponiert und in `settings-handlers.js` registriert, werden aber nirgends im Renderer aufgerufen. Die UI fährt ausschließlich über `commitSettings` / `setActivePreset`.

- [ ] Handler in `settings-handlers.js` entfernen (Zeilen ~46–109)
- [ ] `preload/index.js` und `shared/ipc-channels.js` aufräumen
- [ ] Vendor-Bundle regenerieren

### M2 — Sidebar-/Chat-Panel-Breiten werden nicht persistiert

`SidebarResizer.js` setzt `style.width` direkt, speichert aber nichts. Andere UI-Prefs (Content-Pane sichtbar, System-Prompt, Locale) sind persistent — Inkonsistenz.

- [ ] `sidebarWidth` und `chatPanelWidth` zu `ui-preferences.json` hinzufügen
- [ ] Bei `mouseup` im Resizer in `setUIPrefs` schreiben (debounced)
- [ ] Beim App-Start die Werte wiederherstellen

### M3 — Fehlerbehandlung in Providern uneinheitlich

`ollama.js` nutzt `describeFetchError(err, baseUrl)` mit `cause.code/errno/message`. `openai.js`, `anthropic.js`, `google.js`, `mlx-lm.js` geben nur `err.message || 'Netzwerkfehler'` zurück. Lokale Verbindungsprobleme bei MLX-LM sehen damit identisch aus wie ein generischer OpenAI-Hänger.

- [ ] `describeFetchError` nach `stream-helpers.js` ziehen
- [ ] In allen Providern verwenden (sowohl `listModels` als auch `streamChatRound`)

### M4 — Keine Trim-/Truncation-Strategie für Chat-History

`chat-handlers.js` schickt **die komplette `apiMessages` jede Runde**. Bei langen Sessions mit großen `read_file_text`-Resultaten droht Provider-Token-Limit oder unnötiger Cost-Burst.

- [ ] Token-Heuristik (Char-Count / Provider-spezifisch) hinzufügen
- [ ] Konfigurierbares Trim-Window in `ui-preferences.json`
- [ ] Optional: alte Tool-Outputs auf "..." kürzen, User-Nachrichten behalten

### M5 — Dynamic `require` von `providers/ollama` im `will-quit`-Handler

```261:264:src/main/index.js
app.on('will-quit', () => {
  const { destroyInsecureDispatcher } = require('./providers/ollama');
  destroyInsecureDispatcher();
});
```

- [ ] `providers/index.js` um optionales `disposeAll()` erweitern
- [ ] Jeder Provider exportiert optional `dispose()`
- [ ] Im `will-quit` nur noch `providers.disposeAll()` aufrufen

### M6 — Anthropic `tool_use_id` fällt still auf leeren String zurück

```76:78:src/main/providers/anthropic.js
        type: 'tool_result',
        tool_use_id: m.tool_call_id || '',
```

Wenn ein vorheriger Assistant-Block ohne `id` durchschlüpft, schickt der Adapter `tool_use_id: ''` und Anthropic antwortet 400.

- [ ] Block überspringen oder explizit Fehler an Caller propagieren
- [ ] Test mit fehlender `tool_call_id`

### M7 — Google: `MALFORMED_FUNCTION_CALL` als `tool_calls` interpretiert

```193:194:src/main/providers/google.js
        else if (fr === 'TOOL_CALLS' || fr === 'MALFORMED_FUNCTION_CALL') finishReason = 'tool_calls';
```

`MALFORMED_FUNCTION_CALL` ist ein Fehlerzustand des Modells, kein gültiger Tool-Call-Stop. Die Tool-Loop läuft danach in eine leere Runde.

- [ ] `MALFORMED_FUNCTION_CALL` als Fehler behandeln und an User zurückgeben
- [ ] Klartext-Hinweis "Modell hat einen ungültigen Function-Call erzeugt"

### M8 — Tests fokussieren nur auf reine Hilfen / Translations

Es fehlen Tests für:

- [ ] `chat-history-handlers.js` end-to-end (Lock-Verhalten unter Concurrency)
- [ ] `settings-handlers.js` (`commitSettings`-Flow, `mergeProviderPatch`, `listModels`-Errorpaths)
- [ ] `fs-handlers.js` (Boundary-Checks via IPC)
- [ ] `providers/openai.js` `streamChatRound` mit gemockten SSE-Streams
- [ ] `providers/mlx-lm.js` Translations + `applyToolCallDelta`
- [ ] `iterSseEvents` als isolierter Test mit mehreren Edge-Cases

### M9 — `assertAbsolutePathInWorkspace` fährt Umweg

```23:33:src/main/services/fs-service.js
  function assertAbsolutePathInWorkspace(workspaceRoot, absPath) {
    ...
    const rel = path.relative(path.resolve(workspaceRoot), path.resolve(raw));
    return resolveWorkspacePath(workspaceRoot, rel);
  }
```

Statt direkt zu prüfen, ob der absolute Pfad unter dem Root liegt, geht der Code über `relative` → `resolveWorkspacePath` (das wieder `path.relative` macht).

- [ ] Zentrale `containsPath(root, candidate)`-Funktion einführen
- [ ] `assertAbsolutePathInWorkspace` und `resolveWorkspacePath` darauf aufbauen lassen

### M10 — Renderer-Kopplung an mutierten `appStore`-Singleton

`appStore` wird quer durch Components gemeinsam mutiert (Drag, Voice, Chat-State, LLM-State). Subtile Bugs entstehen leicht — z. B. hängengebliebene `dragSourceRow`-Referenzen ohne zentralen Cleanup-Pfad.

- [ ] Bereiche kapseln (`dragStore`, `voiceStore`, `chatStore`)
- [ ] Oder Pub/Sub einführen, sodass Components nicht mehr direkt mutieren
- [ ] DOM-Refs aus `app.js` in Component-spezifische Selektoren verschieben

---

## Niedrig — Polish / Code-Smells / Doku

### G1 — Drei separate `document.click`-Handler fürs Outside-Click-Handling

`app.js:307` (chatHistoryDrawer), `FileTree.js:221` (folderHistoryMenu), `ChatModelPicker.js:212` (chatModelMenu).

- [ ] Gemeinsamen `dismissOnOutsideClick(el, onDismiss)`-Helper bauen

### G2 — Mischung deutscher/ASCII-Anführungszeichen

```13:14:src/main/ipc/chat-handlers.js
      `\n\nDer Nutzer hat gerade folgende ${kind} im Baum ausgewählt: „${selectedRelPath}". ` +
```

- [ ] Auf konsistente deutsche Anführungszeichen umstellen (`„…"`)

### G3 — Magische Limits hartkodiert in `index.js`

`MAX_FOLDER_HISTORY = 10`, `MAX_CHAT_SESSIONS = 200`, `MAX_READ_FILE_BYTES`. Andere Limits (`MAX_TOOL_ROUNDS`) sind via UI-Prefs überschreibbar.

- [ ] Optional auf `ui-preferences.json` migrieren, sonst zumindest in `src/shared/limits.js` zentralisieren

### G4 — `read_file_text`-Tool-Description erwähnt das 2-MB-Limit nicht

```57:74:src/main/index.js
      description:
        'Liest den Textinhalt einer Datei als UTF-8 (nur innerhalb des Projektordners).',
```

- [ ] Description um "Maximale Dateigröße: 2 MB" ergänzen, damit Modell den Fehlerfall versteht

### G5 — `summarizeToolCall` lokalisiert im Main, nicht im Renderer

UI-Strings würden besser in den Renderer passen, der `appLocale` kennt.

- [ ] Tool-Phasen via Daten (`{ tool, args, phase }`) pushen
- [ ] Renderer formatiert die Anzeige selbst

### G6 — Doppelter `removeAttribute`-Aufruf

```146:151:src/renderer/components/ChatModelPicker.js
        chatTitleEl.textContent = projectName;
        chatTitleEl.removeAttribute('lang');
      } else {
        chatTitleEl.textContent = 'Chat';
        chatTitleEl.removeAttribute('lang');
      }
```

- [ ] `removeAttribute('lang')` aus der Verzweigung herausziehen

### G7 — `bareModelId` ohne Input-Validierung

```5:9:src/main/providers/google.js
function bareModelId(modelOrPath) {
  const s = String(modelOrPath || '').trim();
  if (s.startsWith('models/')) return s.slice('models/'.length);
  return s;
}
```

- [ ] Whitelist-Regex (`/^[a-zA-Z0-9._-]+$/`) prüfen oder bei ungültigem Input Fehler werfen

### G8 — `iterStreamLines` flusht den `TextDecoder` am Ende nicht

```1:15:src/main/providers/stream-helpers.js
async function* iterStreamLines(reader) {
  const decoder = new TextDecoder();
  ...
}
```

- [ ] Nach der Loop `decoder.decode()` (ohne Argument) aufrufen, um multi-byte UTF-8-Reste zu yielden

### G9 — RAF-ID lebt im globalen `appStore`

```183:188:src/renderer/components/ChatStream.js
    if (appStore.streamRenderRaf) cancelAnimationFrame(appStore.streamRenderRaf);
    appStore.streamRenderRaf = requestAnimationFrame(() => {
```

- [ ] Lokale Variable im Component-Closure verwenden statt `appStore`

### G10 — Keine JSDoc-Typedefs für die Provider-Adapter

- [ ] `@typedef`-Block für `streamChatRound`-Parameter (config, model, messages, tools, callbacks) und Rückgabe (`{message, finishReason, error?, code?}`) anlegen
- [ ] Gemeinsam in `src/main/providers/types.js` (oder `index.js`) ablegen

### G11 — README-Projektstruktur ist veraltet

```82:91:README.md
├── main.js              Electron Main-Prozess (IPC, Tool-Use, Provider-Routing)
├── preload.js           sichere Bridge zwischen Main und Renderer
├── providers/           Adapter für OpenAI, Anthropic, Google, Ollama
```

- [ ] Auf `src/main/`, `src/preload/`, `src/main/providers/`, `src/renderer/` aktualisieren
- [ ] `test/` und `src/shared/` ergänzen

### G12 — `safeJsonParse`-Fallback in `google.js` verpackt Tool-Output

```120:122:src/main/providers/google.js
      const response = safeJsonParse(m.content, { result: m.content });
```

- [ ] Aktuell theoretisch, da Tools immer JSON liefern — aber dokumentieren oder konsistent strikt JSON erzwingen

---

## Empfohlene Reihenfolge

1. **Dead Code raus** (M1) — schneller Win, verkleinert die API-Surface.
2. **Cancel/Abort für Chat** (W5) — größter UX-Hebel.
3. **Sidebar-/Chat-Panel-Persistenz** (M2) — kleiner sichtbarer Win.
4. **Lock für Settings/UI-Prefs + Migration-Lock** (W1, W2).
5. **API-Key-Löschen** (W3) — Sicherheit.
6. **Provider-Fehlerbehandlung vereinheitlichen** (M3) + Anthropic/Google-Edge-Cases (M6, M7).
7. **README + IPC-Channel-Namen** (W4, G11) — Hygiene.
8. **Tests für Stream-Loops & IPC-Handler** (M8) — schützt zukünftige Refactorings.
