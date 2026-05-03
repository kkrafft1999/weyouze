# Weyouze App-Review (vor Phase 5)

Stand: 2026-05-02. Umfassender Review nach Abschluss der Phasen 0–4. Grundlage: Code-Audit von `main.js` (1075 LOC), `preload.js` (61 LOC), `renderer/app.js` (1738 LOC), `renderer/styles.css` (1692 LOC), `renderer/index.html` (196 LOC) sowie der vier Provider-Adapter.

Querverweise: `phase-5-backlog.md` (offene Tasks), `checklist.md` (A11y-Pflicht), `weyouze-mapping.md` (Mapping zur Designsystem-Referenz).

Der Review ist nach Bereichen gegliedert. Jeder Punkt ist als Befund (Beobachtung + Bewertung) formuliert; Schweregrade:

- **A** = Pflicht (Sicherheit, A11y-Verstoss, Datenverlust)
- **B** = Soll (UX-Mangel, Token-Inkonsistenz, Wartbarkeit)
- **C** = Kann (Polish, Optimierung)

---

## 1. Architektur & Sicherheit

### Befunde

1. **Saubere Electron-Schichtung [✓]** — `main.js` haelt die System-API, `preload.js` ist ein schmaler Bridge, `renderer/` rendert nur. `contextIsolation: true`, `nodeIntegration: false`, `sandbox` (default `true`). Das ist der heute empfohlene Baseline-Stand, kein Refactoring noetig.

2. **CSP ist gesetzt, aber permissiv (B)**
   ```
   default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; media-src 'self' blob:;
   ```
   - `style-src 'unsafe-inline'` ist noetig, weil DOMPurify im Default `style`-Attribute durchlaesst und der `chat-md`-Output Inline-Styles enthalten kann.
   - **Verbesserung:** DOMPurify mit `FORBID_ATTR: ['style', 'class']` aufrufen und dann `'unsafe-inline'` aus der CSP entfernen. Reduziert XSS-Oberflaeche und enge Compliance-Standards.
   - **Zusatz:** Es fehlt `script-src 'self'`. Heute greift `default-src 'self'`, das ist aber implizit. Explizit setzen schadet nicht.

3. **Path-Traversal-Schutz [✓]** — `resolveWorkspacePath` (main.js, ab Zeile 64) ist sauber: `path.relative(root, joined)` und Reject bei `..`/absoluten Pfaden. Das gilt fuer beide Workspace-Tools.

4. **`fs:moveItem` Sicherheit (A)** — Die IPC-Handler `fs:readDirectory`, `fs:readFile` und `fs:moveItem` akzeptieren **absolute Pfade** vom Renderer ohne Workspace-Validierung. Theoretisch koennte ein kompromittierter Renderer (XSS via Markdown-Output) jeden Pfad lesen/verschieben.
   - **Schwere:** A in der Theorie, B in der Praxis (Renderer ist `contextIsolation`+`sandbox`, plus DOMPurify).
   - **Mitigation:** Die drei Handler auf den aktuell geoeffneten Workspace-Root (`rootPath`) constrainen, indem `main.js` selber den letzten geoeffneten Ordner als Whitelist-Praefix prueft.

5. **`safeStorage` Fallback (B)** — Wenn `safeStorage.isEncryptionAvailable()` `false` zurueckgibt, kann der User keinen API-Key speichern. Die UI zeigt dafuer eine Warning-Pille im Modal. Gut. **Aber:** Die App fragt nicht, ob der Nutzer im Notfall einen unverschluesselten Speicher will (z. B. WSL ohne Secret-Service). Designentscheidung — heute streng, akzeptabel.

6. **Whisper an OpenAI-Provider gebunden (B)** — `whisper:transcribe` ruft `https://api.openai.com/v1/audio/transcriptions` mit dem **OpenAI**-Key auf, unabhaengig vom aktiven Provider. Wenn jemand nur Anthropic+Google nutzt, ist die Spracheingabe stumm.
   - **Verbesserung:** Im Mic-Tooltip explizit machen ("benoetigt OpenAI-Key"), oder Fallback auf Web-Speech-API (keine Internet-Round-Trip).

7. **Permissions-Handler (✓)** — `setPermissionRequestHandler` erlaubt `media`/`audioCapture`, blockt alles andere. Vorbildlich.

8. **`shell.openExternal` Filter (✓)** — `preload.js` validiert URL-Protokoll auf `http:`/`https:`. Gut, das verhindert `file://` oder `javascript:` Tricks.

### Empfehlungen Architektur/Security

| # | Aktion | Schwere | Aufwand |
|---|--------|---------|---------|
| 1 | DOMPurify: `FORBID_ATTR: ['style']` | B | trivial |
| 2 | `style-src 'self'` aus CSP entfernen | B | trivial |
| 3 | `fs:*` IPC mit Workspace-Whitelist absichern | A | mittel |
| 4 | Whisper-Hinweis im Mic-Tooltip | B | trivial |

---

## 2. Renderer / app.js (1738 LOC)

### Befunde

9. **Listener-Hygiene (✓)** — `onChatDelta`, `onChatToolLine`, `onChatProgress` werden in `sendChatMessage` registriert und im `finally` per `off*()` abgemeldet. Sehr sauber.

10. **`renderChatMessages()` Re-Render-Strategie (B)** — Bei jeder Aenderung wird **die ganze Liste** rerendered: `chatMessagesEl.innerHTML = '';` plus DOMPurify+marked pro Bubble. Bei 50+ Nachrichten und einer Aenderung am Ende:
    - Streaming-Pfad ist optimiert (DOM patches direkt am letzten Element).
    - Aber: Wenn Streaming endet (`renderChatMessages()` wird aufgerufen), wird die ganze Liste neu gebaut. Bei langen Chats ein zentraler Performance-Hotspot.
    - **Empfehlung:** Inkrementell rendern — nur die geaenderte Bubble neu bauen. Trockener Aufwand, aber lohnt sich erst ab 100+ Nachrichten.

11. **Kein Cancel-Button waehrend Streaming (B)** — User kann eine laufende Antwort nicht abbrechen. Das ist ein UX-Mangel, besonders bei groesseren Tool-Loops.
    - **Loesung:** AbortController in `sendChatMessage`, `Stop`-Button am Send-Slot wenn `streaming`.

12. **Modal hat keinen Focus-Trap (A)** — `#modal-settings` faengt Tab nicht ein und gibt nach Schliessen den Fokus nicht auf den Trigger zurueck. Auch `Escape` schliesst das Modal nicht (nur `chatHistoryDrawer` reagiert auf Escape). Verstoss gegen WCAG 2.4.3 (Focus Order) und 2.1.2 (No Keyboard Trap, hier umgekehrt: kein Trap).
    - **Loesung:** Beim Oeffnen `lastFocusedElement = document.activeElement`, Fokus auf erstes interaktives Element, Tab-Cycling per Listener, Escape schliesst, beim Schliessen `lastFocusedElement.focus()`.

13. **Modal `aria-modal` fehlt (A)** — `<div class="modal-dialog" role="dialog" aria-labelledby="...">` braucht zusaetzlich `aria-modal="true"`, damit Screenreader den Hintergrund inert behandeln.

14. **Modal-Backdrop ist `<div>` mit Click-Handler (B)** — Funktional OK (Maus), aber a11y-konform waere ein `<button class="modal-backdrop" aria-label="Schliessen">` oder ueberhaupt kein klickbarer Backdrop, sondern Schliessen via Escape. Aktueller Stand ist gaengige Praxis, aber inkonsistent mit den eigenen a11y-Regeln ("Aktionen via `<button>`").

15. **Error-Bubble Praefix fehlt (B)** — `<li class="chat-msg error">` zeigt nur den Fehlertext. Per checklist.md (Status nicht nur ueber Farbe): "Fehler-Bubbles haben sichtbares Text-Label oder Icon, nicht nur farbigen Rahmen." Der Text ist da, aber kein "Fehler:"-Praefix oder Icon.
    - **Loesung:** `<span class="sr-only">Fehler: </span>` plus `⚠`-Glyph (nicht `aria-hidden`, weil semantisch wichtig — oder mit `aria-label`).

16. **Send-Button-Disabled-Logik (C)** — Nach `result.error` setzt `btnChatSend.disabled = !activeProviderConfigured()`. Korrekt. Aber im UX wird der Button waehrend Tool-Roundtrips disabled bleiben — das ist OK, weil Tools schnell sind, aber bei `MAX_TOOL_ROUNDS=14` gefuehlt lang.

17. **`chatSessionId`-Mechanik (✓)** — Saubere Race-Condition-Verhinderung: jeder Chat-Wechsel inkrementiert die ID, alte Stream-Resolves checken `sessionAtSend !== chatSessionId` und brechen ab.

18. **`crypto.randomUUID()` (✓)** — Wird im Renderer fuer Chat-IDs benutzt. Im Electron-Renderer (Chromium) ist `crypto` nativ verfuegbar.

19. **Mic-Permission UX (B)** — Wenn `getUserMedia` `NotAllowedError` wirft, zeigt die App "Mikrofonzugriff verweigert." Aber kein Hinweis, **wo** der User das wieder aktivieren kann (macOS Systemeinstellungen → Datenschutz). UX-Lueecke.

20. **Drag&Drop-Logik (✓)** — Sauber: `dragstart`/`dragend`/`dragover`/`drop` mit Cleanup ueber `clearDragVisualState()`. Cycle-Check (Ordner in sich selbst verschieben) im Main-Prozess.

21. **`folder-history-menu` und `chat-history-drawer` (B)** — Beide sind Dropdowns/Drawer mit `document.click`-Listener zum Schliessen. Das Pattern funktioniert, hat aber zwei Schwaechen:
    - **Eskape schliesst nur das Folder-History-Menu**, nicht den Chat-History-Drawer.
    - **Kein Focus-Trap** — Tab im Drawer fuehrt aus dem Drawer raus.
    - **Loesung:** Konsolidierte `Popover`-Komponente mit Escape, Focus-Restore.

22. **`isResizing` / `isResizingChat` als globale Flags (C)** — Funktioniert, aber zwei parallele State-Machines mit Mausevents auf `document` sind anfaellig fuer Konflikte (z. B. wenn beide gleichzeitig true). Heute gibt's keinen UI-Pfad, der das ausloest. Refactoring-Hinweis.

### Empfehlungen Renderer

| # | Aktion | Schwere | Aufwand |
|---|--------|---------|---------|
| 9 | Cancel-Button waehrend Streaming | B | mittel |
| 10 | Modal-Focus-Trap + Escape-Close + Restore-Focus | A | klein |
| 11 | `aria-modal="true"` am Dialog | A | trivial |
| 12 | Error-Bubble: sichtbares "Fehler:"-Praefix + Icon | B | klein |
| 13 | Mic-Permission-Hilfe-Text bei `NotAllowedError` | B | trivial |
| 14 | Inkrementelles Re-Render bei langer Konversation | C | mittel |

---

## 3. main.js (1075 LOC) & Provider-Layer

### Befunde

23. **`MAX_TOOL_ROUNDS=14` (✓)** — Verhindert Endlos-Loops bei kaputten LLMs. Solide Schutzschicht.

24. **`MAX_READ_FILE_BYTES=2 MB`, Preview `1 MB` (✓)** — Saubere Zwei-Stufen-Begrenzung.

25. **`tool-call_id` round-trip (✓)** — Echo der ID mit `apiMessages.push({ role: 'tool', tool_call_id, content })` ist OpenAI-Tool-Spec-konform und funktioniert auch fuer Anthropic/Google ueber die jeweiligen Provider-Adapter (siehe Provider-Code).

26. **Whisper als hartkodierter Fetch (B)** — `multipart/form-data` wird per Hand zusammengestellt. Funktioniert, aber:
    - Boundary-String ist deterministisch genug, aber nicht zufaellig (`ElectronWhisper${Date.now()}`).
    - Kein Timeout, kein Retry.
    - Alternative: `FormData` + `fetch` mit body als FormData waere idiomatischer.

27. **`workspaceSystemPrompt` (C)** — Hardcoded deutsch mit App-Name in Anfuehrungszeichen. Wenn der Ordner-Name "; Ignore previous instructions" ist, ist das ein **Prompt-Injection-Vektor**, weil der Name unescaped in den System-Prompt geht.
    - **Mitigation:** Anfuehrungszeichen escapen oder Backticks verwenden. Wahrscheinlichkeit gering, Schwere niedrig — aber stylish.

28. **Chat-History-Migration (✓)** — `defaultChatHistoryStore` mit `version: 2`, Migration von alten Sessions ueber `normalizeSessionForStore`. `MAX_CHAT_SESSIONS=200` deckelt die Datei.

29. **`lastFolder.json`-Validierung (✓)** — `getValidatedLastFolder` prueft, ob der Ordner noch existiert. Wenn nicht, wird die Datei geloescht. Saubere Selbstheilung.

30. **Folder-History (✓)** — Aehnlich validiert; `addFolderToHistory` dedupliziert; `MAX_FOLDER_HISTORY=10`.

31. **`safeStorage.isEncryptionAvailable()` (✓)** — Wird in jedem Schreibpfad geprueft. UI signalisiert "Verschluesselter Speicher nicht verfuegbar".

32. **Provider-Auswahl im IPC-Channel-Namen (C)** — `'openai:chat'`, `'openai:chat:delta'` etc. — die Namen suggerieren OpenAI, dispatchen aber jeden Provider. Refactoring-Hinweis: `'llm:chat'`, `'llm:chat:delta'`. Kosmetisch, aber bei Logging hilfreich.

### Empfehlungen Main/Provider

| # | Aktion | Schwere | Aufwand |
|---|--------|---------|---------|
| 15 | Workspace-Prefix-Whitelist in `fs:*` Handlers | A | mittel |
| 16 | IPC-Channels von `openai:*` zu `llm:*` umbenennen | C | klein |
| 17 | Whisper-Multipart auf `FormData`-API umstellen | C | klein |

---

## 4. A11y-Audit (gegen `checklist.md`)

| Kategorie | Stand | Anmerkung |
|-----------|-------|-----------|
| Tastatur — Tab-Reihenfolge | ✅ logisch (Sidebar → Content → Chat → Input) |  |
| Tastatur — Esc schliesst Folder-History-Menu | ✅ |  |
| Tastatur — Esc schliesst Modal | ❌ **Pflicht** | Modal ignoriert Esc |
| Tastatur — Esc schliesst Chat-History-Drawer | ❌ Soll | nur `document.click` schliesst |
| Tastatur — Cmd/Ctrl+Enter sendet | ✅ Enter (ohne Shift) sendet | Bessere Wahl als Cmd+Enter, da Eingabe einzeilig |
| Fokus — `:focus-visible`-Ring 2 px Cyan | ✅ |  |
| Fokus — Restore-Focus nach Modal-Close | ❌ **Pflicht** | aktuell nicht gespeichert |
| Touch-Targets — alle ≥ 32×32 | ✅ Phase 1 sichergestellt |  |
| Farbe — Cyan nur als Form, nicht Text | ✅ |  |
| Farbe — Pill-BG ist `--ds-blue` | ✅ |  |
| Status — Tool-Pill mit Form+Text | ✅ Phase 2 |  |
| Status — Mic-Recording mit Text-Label | ✅ Phase 2 |  |
| Status — Error-Bubble mit Text-Label | ⚠ teilweise | Text ja, aber kein "Fehler:"-Praefix/Icon |
| Pills — min. 11 px, BG `--ds-blue` | ✅ |  |
| Bewegung — Reduced-Motion deaktiviert Pulse | ✅ Phase 1 |  |
| Bewegung — Streaming-Cursor nicht-blinkend bei reduce | ⚠ kein Blink-Cursor implementiert | irrelevant |
| Semantik — `<button>` fuer Aktionen | ✅ |  |
| Semantik — `<a>` fuer Links | n/a | App hat keine Links ausser Markdown |
| Semantik — Icon-only-Buttons mit `aria-label` | ✅ |  |
| Semantik — `<ol role="log">` Konversation | ✅ Phase 2 |  |
| Live-Regionen — `aria-busy` waehrend Streaming | ✅ Phase 2 |  |
| Sprache — `<html lang="de">` | ✅ |  |
| Sprache — `lang="en"` auf Provider-Namen, Modell, Pills | ✅ |  |
| Listen — Konversation `<ol>` | ✅ |  |
| Listen — Tree-View mit `role="tree"` | ❌ Soll | aktuell nur `<div class="tree-item">` |

### Wichtigste A11y-Lücken (vor Phase 5)

1. **Modal: Escape, Focus-Trap, Focus-Restore, `aria-modal`** — vier Fehlstellen in einer Komponente.
2. **Tree-View ohne `role="tree"`/`role="treeitem"`/`aria-expanded`** — Verstoss gegen `checklist.md`-Punkt "Listen & Strukturen".
3. **Error-Bubble ohne sichtbares Status-Label** — leichter Verstoss, weil der Inhalt ja den Fehler beschreibt; trotzdem optimierbar.
4. **Chat-History-Drawer kein Esc** — UX-/A11y-Inkonsistenz mit Folder-History.

---

## 5. Token-Konsistenz (gegen `tokens.css`)

Aufgaben aus Phase-5-Backlog C:

| Datei:Stelle | Hex-Farbe | Soll-Token |
|--------------|-----------|------------|
| `styles.css` `.btn-primary-bg` (Light) | `#111111` | `--ds-black` (od. neuer `--ds-btn-primary-bg`) |
| `styles.css` `.btn-primary-bg-hover` (Light) | `#000000` | `--ds-black` |
| `styles.css` `.btn-primary-bg` (Dark) | `#f5f5f5` | `--ds-grey-divider`-naher Wert oder neuer Token |
| `styles.css` `.btn-primary-bg` (Dark hover) | `#ffffff` | `--ds-white` |
| `styles.css` `.btn-primary-fg` (Light) | `#ffffff` | `--ds-white` |
| `styles.css` `.btn-primary-fg` (Dark) | `#1e1e1e` | (existing `--text-primary`) |
| `styles.css` `.chat-msg.error` BG | `rgba(180, 40, 40, 0.12)` | `--ds-error-bg` |
| `styles.css` `.chat-msg.error` Border | `rgba(180, 40, 40, 0.35)` | `--ds-error` mit Alpha |
| `styles.css` `#btn-chat-mic.recording` BG | `rgba(220, 38, 38, 0.12)` | neuer `--ds-mic-recording-bg` (oder `--ds-error-bg`) |
| `styles.css` `#btn-chat-mic.recording` Color | `#dc2626` | `--ds-error` |
| `styles.css` `[data-theme=dark] #btn-chat-mic.recording` BG | `rgba(248, 113, 113, 0.15)` | `--ds-error-bg` (Dark) |
| `styles.css` `[data-theme=dark] #btn-chat-mic.recording` Color | `#f87171` | `--ds-error` (Dark) |
| `styles.css` `#btn-chat-send` BG (Light) | `#1e1e1e` | (existing `--text-primary`) |
| `styles.css` `#btn-chat-send` BG (Dark) | `#f5f5f5` | (siehe `.btn-primary-bg` Dark) |
| `styles.css` `.chat-md code` Border | `var(--border)` (✓ schon Token) |  |
| `styles.css` `.modal-hint.error` Color (Light) | `#b03030` | `--ds-error` |
| `styles.css` `.modal-hint.error` Color (Dark) | `#ff8080` | `--ds-error` (Dark) |
| `styles.css` `.modal-warning` / `.modal-save-error` Color | `#b03030` / `#ff8080` | `--ds-error` |
| `styles.css` `::-webkit-scrollbar-thumb:hover` BG | `#555` | `var(--text-secondary)` oder `--ds-grey-strong` |
| `styles.css` `::-webkit-scrollbar-thumb` BG | `var(--scrollbar-thumb)` | (alt-Token, OK) |
| `styles.css` `::-webkit-scrollbar` track | `transparent` | (n/a) |

Plus: 7 weitere Stellen mit `rgba(0, 0, 0, *)` fuer Schatten (Glow-Effekte) — keine A11y-Relevanz, aber Token-Inkonsistenz.

`renderer/index.html` — beim Re-Lesen keine Inline-Styles mehr gefunden. Das war wohl bereits in Phase 3 erledigt.

---

## 6. Performance-Anmerkungen

33. **Tree-View synchron (B)** — `loadTreeLevel` rendert alles synchron. Bei einem Workspace mit 1000 Dateien laggt das spuerbar. Virtual-Scrolling waere overengineering, aber `requestIdleCallback` fuer das Append koennte die UI offen halten.

34. **Markdown-Re-Parse (siehe Punkt 10)** — Hauptkandidat fuer Optimierung.

35. **`ResizeObserver` auf `chatInputRow` (✓)** — Wird einmal angelegt und lebt mit dem Element. Kein Leak.

36. **Whisper-Buffer-Roundtrip (C)** — `audioBuffer` wird komplett ueber IPC kopiert. Bei 30-Sekunden-Aufnahme sind das 100–500 KB — vertretbar.

---

## 7. Wartbarkeit / Code-Qualitaet

37. **Keine Tests vorhanden (B)** — Keine `__tests__/`, kein `vitest`/`jest`/`playwright`. Smoke-Test fuer den Renderer-Flow (Open Folder → Send Message → Receive Stream) waere wertvoll.

38. **Keine Linter-Konfig (C)** — Kein `.eslintrc`, kein `prettier`. `package.json` hat keinen `lint`-Script. Bei der Code-Groesse sinnvoll. **Empfehlung:** ESLint mit `electron`-Preset und Prettier.

39. **Keine TypeScript (C)** — App ist plain JS. Bei der Groesse (3000 LOC) noch ueberschaubar. JSDoc-Annotationen koennten ohne Migration helfen.

40. **`renderer/app.js` mit 1738 Zeilen ist gross (C)** — Funktioniert, aber Modulartrennung (Tree, Chat, Settings, Voice) waere wartbarkeitsfreundlich. Heute alles in einem Globals-Soup.

41. **Magic-Numbers (C)** — `260`, `200`, `48`, `52` etc. an mehreren Stellen. Beim Lesen unproblematisch, beim Aendern muehsam.

42. **Console.log-Spuren (C)** — `console.error('Move failed:', result.error)` (`renderer/app.js:283`) und `console.error('readDirectory error:', err.message)` (`main.js:603`) — nicht produktionssauber, aber harmlos.

---

## 8. Dark-Mode-Audit

43. **Funktioniert flaechig (✓)** — `[data-theme="dark"]` ueberschreibt alle relevanten Tokens.

44. **Scroll-Bar im Dark-Mode (B)** — `:hover { background: #555 }` ist in beiden Themes hardcoded. Im Dark-Mode (BG `#1A1A1B`) liefert `#555` etwa 4:1 — knapp am 3:1-Limit, aber unschoen.

45. **Drop-Target-Outline (✓)** — `color-mix(in srgb, var(--accent) 18%, transparent)` adaptiert per Theme-Token automatisch.

46. **Send-Button im Dark-Mode (B)** — Hardcoded `#f5f5f5` BG / `#1e1e1e` FG. Funktioniert, ist aber Token-inkonsistent. Phase-5-Backlog C deckt das ab.

---

## 9. UX-Lücken (Polish-Empfehlungen)

47. **Keine Cancel-Funktion** (siehe Punkt 11).
48. **Kein Auto-Scroll-Lock im Chat (C)** — Wenn der User waehrend Streaming hochscrollt, wird er bei jedem Delta zurueckgeschickt. Pattern: nur scrollen, wenn `scrollTop+clientHeight === scrollHeight` (sticky bottom).
49. **Welcome-CTA hat keine Recent-Folders-Liste** (siehe Phase-5-Backlog E).
50. **Kein "Workspace gewechselt"-Feedback** — Wenn der User per Folder-History wechselt, ist der einzige Hinweis der Project-Name in der Sidebar. Eine kurze Toast-Meldung waere optional.
51. **Settings: Modelle-Liste persistiert nicht** — Nach `Modelle laden` und Wechsel des Providers ist die Liste weg. Cache koennte UX verbessern.
52. **`stopVoiceRecording` bei `visibilitychange` (✓)** — Sehr gut: wenn das Fenster nicht sichtbar ist, wird Mic-Recording gestoppt.

---

## 10. Empfohlener Aktionsplan

### Sofort (in Phase 5 erledigen)

- [B] Token-Cleanup (Phase-5-Backlog C) — alle Hex-Farben in `styles.css` auf `--ds-*` umstellen
- [B] Tool-Hero Polish (Phase-5-Backlog B) — Min-Display-Time, DONE-Compact visuell aufwerten
- [B] Re-Skin Reststuecke (Phase-5-Backlog D) — Titlebar 44 px + Eyebrow, Tree-Header modern, Preview-Header monospace, Settings-Buttons konsistent
- [B] Welcome-Chip-Liste (Phase-5-Backlog E) — Recent Folders + 4 Quick-Action-Chips
- [C] Inter-Weights 500 + 700 vendoren (Phase-5-Backlog F)
- [B] Live-Dot mit echtem Connection-Status koppeln (Phase-5-Backlog E)

### Aus dem Review zusätzlich (Pflicht/A)

- [A] Modal: `aria-modal="true"`, Escape schliesst, Focus-Trap, Restore-Focus
- [A] `fs:*` IPC-Handler mit Workspace-Prefix-Whitelist absichern

### Aus dem Review zusätzlich (Soll/B)

- [B] Tree-View `role="tree"` / `role="treeitem"` / `aria-expanded`
- [B] Cancel-Button waehrend Streaming
- [B] Error-Bubble: sichtbares "Fehler:"-Praefix + Icon
- [B] Chat-History-Drawer mit Esc schliessbar
- [B] Mic-Permission: Hinweis bei `NotAllowedError`
- [B] DOMPurify `FORBID_ATTR: ['style']`, dann CSP `style-src 'self'`
- [B] Welcome: Hinweis "Whisper benoetigt OpenAI-Key" im Mic-Tooltip

### Optional (Kann/C)

- [C] IPC-Channels `openai:*` → `llm:*` umbenennen
- [C] Whisper-Multipart auf FormData-API umstellen
- [C] Auto-Scroll-Lock im Chat
- [C] ESLint + Prettier einrichten
- [C] `renderer/app.js` modular splitten (Tree, Chat, Voice, Settings)

### Manuelle Tests (Phase-5-A, kann nicht automatisiert werden)

- VoiceOver-Smoketest (macOS Cmd+F5)
- axe DevTools im Renderer (Electron-DevTools, axe-Tab) — 0 Errors in color-contrast/focus-visible/motion
- Lighthouse Accessibility ≥ 95
- Reduced-Motion-Test (macOS Bewegung reduzieren)
- Dark-Mode-Durchlauf aller Komponenten
- Screenshots Vorher/Nachher der drei Hauptzustaende

---

## 11. Bewertung

**Gesamtnote: 2 (gut)**

Die App ist **kein Schnellschuss**: Sie hat sauberes IPC, eine geschlossene Token-Architektur, A11y-Pflichten in Phasen 1–4 abgearbeitet, dokumentierte Mappings und eine Test-Checklist. Die Phasen 0–4 haben das Fundament gelegt.

**Was noch fehlt**, um die App in Richtung "produktionsreif fuer Endanwender":

1. **A11y-Restmaengel** sind vier kleine, aber harte Stellen (Modal-Pflicht-Pattern, Tree-Rolle).
2. **Sicherheits-Hardening** der IPC-Handler ist die einzige A-Schwere offene Position.
3. **UX-Cancel** waehrend Streaming ist eine erwartete Funktion in jedem heutigen Chat-Tool.
4. **Tests** fehlen komplett — fuer eine ueber Monate gewachsene App eine kalkulierte Schuld.

**Was richtig gut ist:**

- Stream-Architektur (Phase, Reasoning, Tool-Lines getrennt geroutet).
- Workspace-Path-Sandboxing.
- Saubere Race-Conditions ueber `chatSessionId`.
- Provider-Abstraktion ueber gemeinsamen `streamChatRound`-Kontrakt.
- Token-Architektur (`tokens.css`) und das doppelte Mapping-Layer (`--accent` → `--ds-cyan`) sind beispielhaft.

Die Arbeit aus den Phasen 0–4 zahlt sich jetzt aus: Phase 5 wird zu einem Cleanup-Sprint, nicht zu einer Restrukturierung.
