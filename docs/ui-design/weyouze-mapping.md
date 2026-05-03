# Weyouze ↔ doubleSlash-Designsystem (Mapping)

Diese Doku zeigt, wie die Weyouze-App Bereich fuer Bereich auf das neue doubleSlash-Designsystem (`doubleslash-a11y-regeln.md` + `doubleslash-chat-design-states-a11y.html`) abgebildet ist. Stand: nach Phase 1–3 (Tokens, A11y-Foundation, Semantik, visueller Re-Skin).

## Architektur-Bild

```
┌─ Titlebar (Drag-Region + Brand + Pane-/Theme-Toggle) ─────────────────────────┐
├─ Sidebar (Tree)         │ Content-Pane (Welcome / File-Preview / File-Info)   │
│  └─ Tree-Header          │  └─ Welcome = doubleSlash empty-body-Pattern        │
│  └─ Tree-Items           │                                                     │
│                          │  ▶ Chat-Panel = doubleSlash ds-card                 │
│                          │     └─ Header (Live-Dot + Mono-Titel + Modell-Pill) │
│                          │     └─ Body (<ol role="log">)                       │
│                          │     └─ Tool-Logs (Hero RUNNING / Compact DONE)      │
│                          │     └─ Input-Row (Mic + Send)                       │
└──────────────────────────┴─────────────────────────────────────────────────────┘
```

## Bereich → Referenz-Pattern


| Weyouze-Bereich     | DOM-Selektor                               | Referenz-Pattern (HTML-Anchor)                    | Status                                          |
| ------------------- | ------------------------------------------ | ------------------------------------------------- | ----------------------------------------------- |
| Titlebar            | `header#titlebar`                          | (nicht in der Referenz; eigene App-Chrome)        | ✅ Phase 5: 44 px + Brand-Eyebrow               |
| Welcome-State       | `#welcome`                                 | `.empty-body` (eyebrow + h1 + sub + CTA + chips)  | ✅ Phase 3 + 5 (Recent + Quick-Actions)         |
| File-Preview-Header | `#preview-header`                          | (custom, nicht im Referenz-Scope)                 | ✅ Phase 5: Mono-Filename + Meta-Pille          |
| Chat-Header         | `#chat-header`                             | `.ds-header` (Live-Dot + mono-Repo + Modell)      | ✅ Phase 3                                       |
| Chat-Konversation   | `ol#chat-messages[role="log"]`             | `<ol class="messages" role="log">`                | ✅ Phase 2                                       |
| User-Nachricht      | `li.chat-msg.user`                         | `.user-msg-text` (Cyan-Border-left, gequotet)     | ✅ Phase 3                                       |
| Assistant-Nachricht | `li.chat-msg.assistant .chat-md`           | `.ai-msg` (Inter 17px / 1.55)                     | ✅ Phase 3                                       |
| Tool-Aufruf laeuft  | `details.chat-tool-log--running`           | `.tool-hero.running` (Cyan-Border + RUNNING-Pill) | ✅ Phase 2+3                                     |
| Tool-Aufruf fertig  | `details.chat-tool-log--done`              | `.tool-compact` + DONE-Pill (Check-Icon)          | ✅ Phase 2+3                                     |
| Status-Pille        | `.chat-pill`                               | `.pill` (Mono, 11px, --ds-blue BG)                | ✅ Phase 2                                       |
| Live-Dot            | `.chat-live-dot` / `.chat-tool-status-dot` | `.live-dot.pulse`                                 | ✅ Phase 2+3                                     |
| Eingabe-Row         | `#chat-input-row`                          | `.ds-input`                                       | Phase 1 Touch-Targets, Phase 3 noch nicht final |
| Settings-Modal      | `#modal-settings`                          | (nicht im Referenz-Scope)                         | ✅ Phase 5: A11y-Hardening (Modal-Pflicht)      |
| Welcome-Chips       | `#welcome-recent-list`, `#welcome-actions-list` | `.chip-list` mit `<button class="chip">`     | ✅ Phase 5                                       |
| Connection-Live-Dot | `#chat-live-dot[data-state]`               | `.live-dot.pulse` (state-driven)                  | ✅ Phase 5                                       |


## Token-Mapping (Single Source of Truth)

`renderer/styles/tokens.css` definiert die `--ds-*`-Tokens. `renderer/styles.css` mappt seine Alt-Tokens (`--accent`, `--text-muted`, `--font-ui`) auf die neuen, sodass keine direkten Hex-Werte fuer A11y-relevante Faelle mehr noetig sind.


| Alt-Token (styles.css)      | Neuer Token (tokens.css)                             | Verwendungsregel                                    |
| --------------------------- | ---------------------------------------------------- | --------------------------------------------------- |
| `--accent`                  | `--ds-cyan` (`#00A5E1`)                              | nur UI-Form (Border, Outline, Send-BG, Drop-Target) |
| `--accent-text` (neu)       | `--ds-blue` (`#00759E` Light / `#3FB8E5` Dark)       | farbiger Text (Markdown-Links, Eyebrow, Mono-Tags)  |
| `--accent-hover`            | `--ds-blue`                                          | Hover-Stufen                                        |
| `--text-muted`              | `--ds-grey-muted` (`#6D6D6D` Light / `#A1A1A6` Dark) | NUR ab 14 px                                        |
| `--text-muted-strong` (neu) | `--ds-grey-strong` (`#5C5C5C` / `#C4C4C9`)           | fuer Texte < 14 px                                  |
| `--font-ui`                 | `--ds-font-ui` (Inter mit System-Fallback)           | gesamte UI                                          |
| `--font-mono`               | `--ds-font-mono`                                     | Code, technische Identifier, Pills                  |


## Status-Visualisierung (immer Farbe + Form + Text)

Nach Regel „Status NIEMALS allein ueber Farbe":


| Zustand          | Farbe                               | Form                                        | Text                                          |
| ---------------- | ----------------------------------- | ------------------------------------------- | --------------------------------------------- |
| Connection live     | Cyan-Dot, normaler Pulse          | pulsierender Kreis                          | `aria-label="Verbindung aktiv"`               |
| Connection streaming | Cyan-Dot, schnellerer Pulse      | pulsierender Kreis                          | `aria-label="Modell antwortet"`               |
| Connection offline  | grauer Dot                        | kein Pulse                                  | `aria-label="Kein KI-Anbieter konfiguriert"`  |
| Tool RUNNING     | Cyan-Border-Left + cyan-Tint Header + Fade-In | pulsierender Live-Dot           | Pill `RUNNING` (lang=en) + sr-only „Status: " |
| Tool DONE        | grauer Container + --ds-blue-Border-Left | Check-Icon                            | Pill `DONE` (lang=en) + sr-only „Status: "    |
| Mic-Recording    | rotes Mic                           | Pulse-Animation                             | Sichtbares Status-Label „Aufnahme laeuft …"   |
| Tree-Item active | Hintergrund-Toenung                 | 2 px Cyan-Border-Left                       | (Datei-Name selber)                           |
| Streaming AI     | (kein Farbsignal)                   | `chat-phase` Animation, „Modell denkt nach" | `aria-busy="true"` am `<ol>`                  |


## Bewegung

Alle Endlos-Animationen werden im Reduced-Motion-Modus abgeschaltet:


| Animation                                       | Datei:Zeile (ca.) | Reduced-Motion-Verhalten          |
| ----------------------------------------------- | ----------------- | --------------------------------- |
| `chatThinkingPulse` (Phase „Modell denkt nach") | `styles.css`      | `animation: none`, `opacity: 0.7` |
| `mic-pulse` (Aufnahme)                          | `styles.css`      | `animation: none`                 |
| `chatPulse` (Live-Dot, Header + Tool-Hero)      | `styles.css`      | `animation: none`                 |
| Token-Transitions (`--ds-motion-fast` etc.)     | `tokens.css`      | auf `0.001s` reduziert            |


## Sprache

- `<html lang="de">` als Default (`renderer/index.html`).
- Englisch-markiert via `lang="en"`:
  - Provider-Optionen im Settings-Modal (`OpenAI`, `Anthropic`, `Google`, `Ollama`)
  - Modell-IDs im Settings-Modal (`gpt-4o-mini`, `claude-opus-4.7`, …)
  - Modell-Pille im Chat-Header (`#chat-model-pill`)
  - Status-Pills im Tool-Log (`RUNNING`, `DONE`)
  - Brand-Eyebrow im Welcome (`WEYOUZE`)

## Manuelle Smoketests (nicht automatisierbar)

Diese Tests sollten vor jedem Release mit der `docs/ui-design/checklist.md` zusammen durchlaufen werden:

1. **Tab-Navigation** komplett durch die UI: Sidebar → Content → Chat → Input. Ringe sichtbar?
2. **VoiceOver** (macOS Cmd+F5): Konversation als Liste? Tool-Pills mit Status korrekt vorgelesen? Provider-Namen englisch?
3. **Reduced Motion** (Systemeinstellungen → Bedienungshilfen → Anzeige → „Bewegung reduzieren"): Pulse + Cursor-Blink stehen?
4. **Dark-Mode** via Theme-Toggle: alle Komponenten lesbar? Cyan-Akzente funktionieren auf dunklem Hintergrund?
5. **axe DevTools** im Renderer (`Ansicht → DevTools` in Electron, dann axe-Tab): 0 Fehler in den Kategorien color-contrast, focus-visible, motion.

## Bekannte offene Punkte (nach Phase 5)

Stand 2026-05-02. Die meisten Phase-5-Punkte sind erledigt; offen geblieben sind nur strukturelle Themen, die in Phase 6 wandern:

- **Tree-View** hat heute keine `role="tree"`/`role="treeitem"`/`aria-expanded` — siehe `phase-5-backlog.md`, Abschnitt „Aus dem Review".
- **Pro-Tool-Kapselung im Chat** (jeder Tool-Aufruf eigener Container): erfordert Backend-Anpassung in `api.onChatToolLine` (Tool-Boundaries melden). Phase 6.
- **Cancel-Button waehrend Streaming**: AbortController-Verdrahtung. Phase 6.
- **`fs:*` IPC-Handler-Sandboxing**: Workspace-Whitelist statt absolutem Pfad. Phase 6 (Schwere A).
- **DOMPurify ohne style-Attribute** + danach `style-src 'self'` in der CSP. Phase 6.

Erledigt in Phase 5:

- ✅ `#tree-header` modernisiert (Inter 13 px Bold + Mono-Eyebrow `// projekt`).
- ✅ Hard-coded Hex-Farben auf `--ds-*` umgestellt (Buttons, Error, Mic, Send, Modal-Errors, Scrollbar).
- ✅ Welcome-Chip-Liste mit Recent Folders + Quick-Action-Chips (analyse, review, test, doc).
- ✅ Live-Dot mit echtem Verbindungs-Status (live/streaming/offline).
- ✅ Titlebar 44 px + Brand-Eyebrow.
- ✅ File-Preview-Header monospace + Meta-Pille.
- ✅ Tool-Hero Min-Display-Time + DONE-Compact mit Blue-Border-Akzent.
- ✅ Modal-A11y-Hardening (Escape, Focus-Trap, Restore-Focus, `aria-modal`).
- ✅ Inter 400/500/600/700 vendoriert.

