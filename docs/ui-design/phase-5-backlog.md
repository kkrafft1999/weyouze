# Phase 5 — Backlog

Stand 2026-05-02 (zweiter Durchlauf): Code-seitige Punkte aus B/C/D/E/F sind abgearbeitet. Was bleibt: die manuellen Test-Artefakte (A) und ein paar bewusste Restpunkte aus dem App-Review. Querverweise: `phase-5-review.md` (umfassender Audit), `weyouze-mapping.md` (Mapping), `checklist.md` (A11y-Pflicht), `doubleslash-a11y-regeln.md` (Quelle der Regeln), `doubleslash-chat-design-states-a11y.html` (Referenz), `manual-tests.md` (Anleitung fuer A).

---

## A. Manuelle Tests & Auslieferungs-Artefakte (offen)

> Phase 4 hat den automatisierten Teil erledigt. Diese Tests laufen am echten System — Anleitung in `manual-tests.md`.

- **VoiceOver-Smoketest (macOS, Cmd+F5)** — Anleitung in `manual-tests.md` Abschnitt 1.
- **axe DevTools** im Renderer (Electron-DevTools, axe-Tab): 0 Errors in `color-contrast`, `focus-visible`, `motion`. — Abschnitt 2.
- **Lighthouse Accessibility**: Score >= 95. — Abschnitt 3.
- **Reduced-Motion-Test**: macOS „Bewegung reduzieren" an/aus. — Abschnitt 4.
- **Dark-Mode-Durchlauf**: jede Komponente einmal im Dark-Theme verifizieren. — Abschnitt 5.
- **Screenshots Vorher/Nachher** der drei Hauptzustaende ablegen unter `docs/ui-design/screenshots/`. Light + Dark. — `screenshots/README.md`.
- `**checklist.md` durchgehen** und Haken setzen (oder Issues nachziehen), wo noch offen.

## B. Tool-Einsatz Visual-Polish (erledigt)

- **Min-Display-Time fuer RUNNING-Hero** — Per CSS-Animation `toolHeroFadeIn` (300 ms). Reduced-Motion deaktiviert es ueber `--ds-motion-medium`.
- **DONE-Compact visuell aufwerten** — Linker Border in `--ds-blue` (55 % alpha) + leichter Tint, klar erkennbar.
- **Pro-Tool-Kapselung** (groessere Aenderung, **bewusst offen**): heute haengen alle Tool-Lines in EINEM gemeinsamen `details`-Container. Cursor-Style waere ein Container pro Tool-Aufruf mit eigenem Status. Erfordert Backend-Anpassung (`api.onChatToolLine` muesste Tool-Boundaries melden). → Phase 6 / Issue.
- **Tool-Trace-Zeile mit Mini-Pille pro Zeile** (**bewusst offen**): aktuell wird nur eine Roh-Zeile angezeigt. Erfordert ebenfalls Backend-Anpassung. → Phase 6.

## C. Token-Konsistenz (erledigt)

- **Hard-coded Hex-Farben** in `renderer/styles.css` migriert:
  - `.btn-primary` → `--ds-btn-primary-bg/-fg/-bg-hover` (neu in `tokens.css`).
  - `.chat-msg.error` → `--ds-error`/`--ds-error-bg`/`--ds-error-border`. Plus sichtbares „⚠ Fehler:"-Praefix per `::before` (a11y, siehe Review #15).
  - `#btn-chat-mic.recording` → `--ds-mic-recording`/`--ds-mic-recording-bg` (neuer Token, weil andere Rotnuance als die Error-Farbe).
  - `#btn-chat-send` → teilt sich `--ds-btn-primary-*` mit dem Modal-Save.
    - **Revidiert 2026-05-03:** Auf `--ds-cyan` (Hover `--ds-blue`) zurueckgestellt, plus `border-radius: 6px` und Icon 16x16/stroke 2. Grund: Die Designsystem-Referenz `doubleslash-chat-design-states-a11y.html` definiert `.ds-send` ausdruecklich mit Cyan-BG ("Send-BG" auch in `tokens.css` und `weyouze-mapping.md`).
    - **Modal-Save 2026-05-03:** `--ds-btn-primary-*` selbst auf `--ds-blue` umgestellt (Light: #00759E + Weiss = 5:1 ✓; Dark: #3FB8E5 + #1E1E1E = ~7:1 ✓). Save-Button ist damit Brand-CTA der Schrift-Familie, Send-Button Brand-CTA der Form-Familie — zwei Akzente derselben Markenpalette. Cyan als Save-BG ausgeschlossen (Cyan/Weiss = 2,5:1, verstoesst gegen Schrift-Kontrast).
    - **Sekundaer-Buttons 2026-05-03:** Hover-Border auf `--ds-cyan` (statt hardcoded `#b3b3b3` / `#5a5a5a`), Active-Scale ergaenzt. Token `--btn-secondary-border-hover` entfernt.
    - **Radius 2026-05-03 (Endstand):** Bewusste Abweichung von der Designsystem-Referenz (.ds-send 6 px). Text-Buttons (Modal-Save, Modal-Secondary) sind Pills (`--btn-radius: 999px`); Icon-Buttons 32×32 (Send, Mic) sind Kreise (`border-radius: 50%`). Begruendung: weicher, freundlicher Look — gemeinsame Sprache "alles rund" statt mixed Rounded-Rectangle. Falls die Designsystem-Referenz aktualisiert wird, sollte `.ds-send` dort ebenfalls auf Kreis geprueft werden.
  - `.modal-hint.error`, `.modal-warning`, `.modal-save-error` → `--ds-error`.
  - `::-webkit-scrollbar-thumb:hover` → `--text-secondary` (nicht mehr `#555`).
- **Inline-Styles in `renderer/index.html`** — bereits in Phase 3 erledigt, beim Re-Lesen keine Stellen mehr gefunden.

## D. Visuelles Re-Skin (erledigt)

- **Sidebar `#tree-header` modernisieren** — Inter 13 px Bold fuer den Projektnamen, plus Mono-Eyebrow `// projekt` darueber. Zweizeilig, weiterhin 32×32-Buttons.
- **Titlebar (`#titlebar`) auf 44 px Hoehe** — plus Brand-Block: Mono-Eyebrow `// WEYOUZE` und Inter 13 px Bold „Anything" darunter. App-Hoehen-Math (`#app: calc(100% - 44px)`) angepasst.
- **File-Preview-Header (`#preview-header`)** — Mono-Filename in `--ds-font-mono`, Groesse als kompakte Pille rechts (Pattern aus tool-hero-arg). Hintergrund auf `--bg-secondary` neutralisiert.
- **Settings-Modal** — alle drei Buttons explizit klassiert (`btn-primary` + 2× `btn-secondary`), `.btn-secondary` mit sichtbarem Default-Border in `--ds-grey-divider` und Hover-Tint. **Plus** A11y-Hardening (siehe nachstehend).

### Modal-A11y-Hardening (aus phase-5-review.md, Schwere A — neu in Phase 5 erledigt)

- `aria-modal="true"` am Dialog gesetzt.
- **Escape** schliesst das Modal (`handleModalKeydown`).
- **Focus-Trap**: Tab/Shift+Tab rotieren innerhalb des Modals.
- **Focus-Restore**: beim Schliessen springt der Fokus zurueck auf den Trigger (Zahnrad).
- **Initial-Focus**: erstes interaktives Element bekommt direkt den Fokus.
- **Chat-History-Drawer** schliesst jetzt auch auf Escape (Konsistenz mit Folder-History-Menu).

## E. Funktionale Erweiterungen (groesstenteils erledigt)

- **Welcome-Chip-Liste mit Recent Folders** — Sektion `#welcome-recent`, max. 4 Eintraege, Mono-Name + Pfad-Untertitel + Pfeil. Klick oeffnet den Ordner. Quelle `api.getFolderHistory()`. Versteckt sich, wenn keine History vorhanden.
- **Quick-Action-Chips** unter dem Welcome-CTA (Sektion `#welcome-quick-actions`): `analyse`, `review`, `test`, `doc`. Click befuellt das Chat-Input mit dem entsprechenden Prompt und sendet automatisch, wenn ein Ordner geoeffnet und ein Provider konfiguriert ist; ansonsten erscheint der Prompt nur im Eingabefeld.
- **Connection-Status-Live-Dot mit echter Status-Logik** — drei States via `data-state` (`live` / `streaming` / `offline`):
  - `live`: Provider konfiguriert, idle → cyan, normaler Pulse, `aria-label="Verbindung aktiv"`.
  - `streaming`: aktive Anfrage → cyan, schnellerer Pulse, `aria-label="Modell antwortet"`.
  - `offline`: Provider nicht konfiguriert → grau, kein Pulse, `aria-label="Kein KI-Anbieter konfiguriert"`.
  Reduced-Motion deaktiviert beide Pulse-Varianten weiter wie gehabt.

## F. Optional: Hooks fuer Designer

- **Dark-Mode-Tokens mit Designer abstimmen** (**Designer-Aufgabe**): die Werte in `tokens.css` (`--ds-grey-bg: #1A1A1B`, `--ds-blue: #3FB8E5` etc.) sind kontrast-validierte Vorschlaege. Vor dem naechsten Brand-Refresh idealerweise verifizieren.
- **Inter-Weights ueberpruefen** — vendoriert sind jetzt 400 + 500 + 600 + 700 (Latin + Latin-Ext). Genutzt: 400 (Body), 500 (CTA, Chips, Sekundaer-Button), 600 (Headlines, Pills, App-Brand, Welcome-Eyebrow), 700 (Welcome-Headline H1).

---

## Aus dem App-Review (`phase-5-review.md`) — bewusst nach Phase 6 verschoben

Die folgenden Punkte sind im Review als Soll/Pflicht markiert, aber bewusst nicht in Phase 5 umgesetzt, weil sie groessere Umbauten erfordern oder unabhaengige Issues darstellen:

### Schwere A (Pflicht, sobald Zeit)

- `**fs:*` IPC-Handler mit Workspace-Whitelist absichern** (Review #4) — `fs:readDirectory`, `fs:readFile`, `fs:moveItem` akzeptieren heute beliebige absolute Pfade. Mitigation: nur Pfade unterhalb des aktuell geoeffneten `rootPath` zulassen.
- **Tree-View `role="tree"` / `role="treeitem"` / `aria-expanded`** (Review #A11y-Audit) — heute nur `<div class="tree-item">`, Verstoss gegen `checklist.md`-Punkt „Listen & Strukturen".

### Schwere B (Soll)

- **Cancel-Button waehrend Streaming** (Review #11) — AbortController-Verdrahtung in `sendChatMessage` plus Stop-Icon im Send-Slot.
- **DOMPurify `FORBID_ATTR: ['style']`** (Review #2) — danach `'unsafe-inline'` aus der CSP entfernen. Reduziert XSS-Oberflaeche.
- **Mic-Permission: `NotAllowedError`-Hilfe** (Review #19) — Hinweis-Text mit Pfad zu macOS Datenschutz-Einstellungen.
- **Whisper-Hinweis im Mic-Tooltip** (Review #6) — STT haengt am OpenAI-Key, das ist heute nicht offensichtlich.

### Schwere C (Kann, kosmetisch)

- **IPC-Channels `openai:`* → `llm:*` umbenennen** (Review #32).
- **Auto-Scroll-Lock im Chat** (Review #48) — Scrolle nur, wenn der User am unteren Rand ist.
- **ESLint + Prettier einrichten** (Review #38).
- `**renderer/app.js` modular splitten** (Review #40) — 1738 LOC in einer Datei.
- **Inkrementelles Re-Render** der Konversation (Review #10).

---

**Stand**: 2026-05-02, nach zweitem Phase-5-Durchlauf.