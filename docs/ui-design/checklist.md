# A11y-Abnahme-Checklist (WCAG 2.1 AA)

Quelle: `docs/ui-design/doubleslash-a11y-regeln.md`. Diese Liste wird vor jedem Release der UI-Anpassung manuell durchgegangen. Bei jeder bestandenen Phase gruen markieren, bei Abweichungen Issue/Notiz im Phasen-Plan ergaenzen.

## Tastatur

- Tab-Navigation funktioniert in logischer Reihenfolge (Sidebar → Content → Chat → Input).
- Shift+Tab navigiert rueckwaerts ohne Fokus-Falle.
- Esc schliesst Modal `KI-Anbieter` und Folder-History-Menu.
- Enter/Space aktiviert jeden Button.
- Cmd/Ctrl+Enter sendet Chat-Nachricht.

## Fokus

- Jedes interaktive Element hat einen sichtbaren Fokus-Ring (`2px solid #00A5E1`, Offset 2 px).
- Kein `outline: none` ohne sichtbaren Ersatz.
- Fokus-Ring nutzt `:focus-visible`, erscheint also nicht beim Maus-Klick.

## Touch-Targets

- Alle Klick-Buttons ≥ 32 × 32 px (idealerweise 44 × 44).
- Send-Button im Chat ≥ 32 × 32.
- Header-Icons (Tree, Chat, Titlebar) mit Padding so, dass das Hit-Target ≥ 32 × 32 ist.

## Farbe & Kontrast

- Cyan `#00A5E1` wird NIE als Textfarbe genutzt — nur als UI-Form (Border, Dot, Send-BG, Fokus-Ring).
- Farbiger Text nutzt Clickable Blue `#00759E` (Light) bzw. `#3FB8E5` (Dark).
- Texte unter 14 px nutzen `--ds-grey-strong` (`#5C5C5C`), nicht `--ds-grey-muted`.
- Pill-Hintergrund ist `--ds-blue`, nie `--ds-cyan` — sonst Weiss-auf-Cyan nur 3,06:1.
- Kontrast aller Textfarben ≥ 4,5:1 (normal) bzw. 3:1 (groß ab 18 pt / 14 pt bold).
- Kontrast aller UI-Komponenten und grafischen Objekte ≥ 3:1.

## Status (nicht nur Farbe)

- Tool-Call-Status erscheint immer als Pill mit Text (`RUNNING` / `DONE`) plus Form (Dot oder Check) — nie nur durch Border-Farbe.
- Mic-Recording-Status hat zusaetzlich zur roten Faerbung sichtbares Text-Label (`Aufnahme laeuft`).
- Fehler-Bubbles (`.chat-msg.error`) haben sichtbares Text-Label oder Icon, nicht nur farbigen Rahmen.

## Pills, Badges, Tags

- Mindestschriftgroesse 11 px, idealerweise 12 px.
- Padding ≥ 3 px vertikal, 9 px horizontal.
- Cyan-Pill mit weisser Schrift hat Hintergrund `--ds-blue`, nicht `--ds-cyan`.

## Bewegung

- `prefers-reduced-motion: reduce` deaktiviert: `chatThinkingPulse`, `mic-pulse`, Live-Dot-Pulse, Cursor-Blink, Wave-Dots, Spinner.
- Streaming-Cursor im Reduced-Motion-Modus durchgehend sichtbar (nicht blinkend).
- Keine flackernden Elemente schneller als 3 Hz.

## Semantik & ARIA

- Alle Aktionen via `<button>`, alle Navigationen via `<a>`, alle Eingaben via `<input>`/`<textarea>` — nie `<div onclick>`.
- Icon-only Buttons haben `aria-label`.
- Dekorative SVGs haben `aria-hidden="true"`.
- Informationstragende SVGs haben `role="img"` + `<title>` (z. B. Live-Dot, Check-Icon).
- Dekorative Zeichen wie `/`, `→`, `·`, `▸` sind in `<span aria-hidden="true">` oder als CSS-Pseudo-Element.
- Konversations-Container ist `<ol id="chat-messages" role="log">` mit `<li>` pro Nachricht.
- Quick-Action-Chips: `<div role="group" aria-label="…">` mit `<button>`-Kindern.

## Live-Regionen

- Konversations-Log: `role="log"` (impliziert `aria-live="polite"`).
- Waehrend Streaming setzt der Renderer `aria-busy="true"`, am Ende `false`.
- Voice-Status `#chat-voice-status` ist `aria-live="polite"`.
- Kritische Fehler nutzen `aria-live="assertive"` (nicht im Streaming!).

## Sprache

- `<html lang="de">` ist gesetzt.
- Englische Fachbegriffe (`RUNNING`, `DONE`, Provider-Namen wie `OpenAI`, `Anthropic`, Modellnamen wie `claude-opus-4.7`, `gpt-4o-mini`) sind in `<span lang="en">` umschlossen.
- Code, Dateinamen, technische Identifier (`package.json`, `bat-toolkit`) bleiben ohne `lang`-Attribut.

## Listen & Strukturen

- Listen verwenden `<ol>` oder `<ul>`, nicht gestapelte `<div>`.
- Tree-View nutzt `role="tree"` / `role="treeitem"` mit `aria-expanded`.

## Screenreader-Smoketest

- VoiceOver (macOS): Konversation wird als „Liste, n Eintraege" gelesen.
- VoiceOver: Tool-Compact wird mit Status-Pill korrekt vorgelesen.
- VoiceOver: Provider-Namen werden englisch gesprochen.
- NVDA (Windows, falls verfuegbar): identische Ergebnisse.

## Build & Tools

- axe DevTools-Scan: 0 Errors fuer color-contrast, focus-visible, motion.
- Lighthouse Accessibility-Score ≥ 95.