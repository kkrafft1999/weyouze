# Barrierefreiheit (WCAG 2.1 AA)

## Farbe

- Verwende Cyan `#00A5E1` NIEMALS als Textfarbe. Der Kontrast 3.06:1 reicht nur für UI-Komponenten (Borders, Hintergrundflächen, Icons), nicht für Schrift.
- Setze farbige Schrift in Clickable Blue `#00759E` (5.0:1 auf Weiß).
- Setze hellgraue Texte (`#6D6D6D`, 4.84:1) nur ab 14 px ein. Für kleinere Schrift dunkleres Grau verwenden.
- Übermittle Status NIEMALS allein über Farbe. Kombiniere immer Farbe + Form + Text. Beispiel: Pill mit Label "RUNNING" + pulsierender Dot, nicht nur Farbwechsel.

## Pills, Badges & Tags

- Cyan-Pill mit weißer Schrift: Hintergrund auf `#00759E` setzen, NICHT `#00A5E1`. Weiß auf `#00A5E1` erreicht nur 3.06:1.
- Mindestschriftgröße in Pills: 11 px, idealerweise 12 px.
- Padding mindestens 3 px vertikal, 9 px horizontal.

## Fokus

- Setze auf JEDES interaktive Element einen sichtbaren Fokus-Ring: `outline: 2px solid #00A5E1` mit `outline-offset: 2px`.
- Verwende `:focus-visible`, nicht `:focus`. So erscheint der Ring nur bei Tastaturnavigation.
- Verzichte NIEMALS auf den Fokus-Ring. `outline: none` ohne sichtbaren Ersatz ist verboten.

## Touch-Targets

- Klickbare Elemente mindestens 32×32 Pixel, idealerweise 44×44.
- Header-Icons (16 px SVG) immer mit min. 8 px Padding rundum, sodass das Klick-Target 32×32 erreicht.
- Send-Buttons: 32×32 minimum, niemals kleiner.

## Bewegung

- Respektiere `prefers-reduced-motion`. Schalte Endlos-Animationen (Pulse, Spinner, Cursor-Blink, Wave-Dots) im Reduced-Motion-Modus aus oder durch statische Zustände ersetzen.
- Verwende keine flackernden Elemente schneller als 3 Hz.
- Streaming-Cursor im Reduced-Motion-Modus: durchgehend sichtbar, nicht blinkend.

## Semantik

- Verwende native HTML-Elemente: `<button>` für Aktionen, `<a>` für Navigation, `<input>` für Eingaben. NIEMALS `<div>` mit `onclick`.
- Setze `aria-label` auf Icon-only Buttons. Beispiel: `<button aria-label="Senden">`.
- Markiere dekorative SVGs mit `aria-hidden="true"`.
- Markiere informationstragende SVGs mit `role="img"` und `<title>`-Element. Beispiel: Live-Dot mit `<title>Verbindung aktiv</title>`.
- Markiere dekorative Zeichen wie `//`, `→`, `·` in Texten mit `<span aria-hidden="true">`.

## Live-Regionen

- Markiere Bereiche mit Status-Updates mit `aria-live="polite"`.
- Setze `aria-live="assertive"` nur bei kritischen Updates (Fehler, Warnungen).
- Konversations-Container: `role="log"` (impliziert `aria-live="polite"`).
- AI-Response während Streaming: NIEMALS `aria-live="assertive"`. Sonst wird jedes Token einzeln vorgelesen.
- Streaming-Pattern: Während Generierung `aria-busy="true"` setzen, am Ende auf `false`.

## Sprache

- Setze `<html lang="de">` als Default.
- Englische Fachbegriffe (z.B. "RUNNING", "DONE", "BAT AGENT") immer mit `<span lang="en">…</span>` umschließen. Sonst spricht der Screenreader sie deutsch aus.
- Code, Dateinamen und technische Identifier (z.B. `package.json`, `bat-toolkit`) bleiben ohne `lang`-Attribut.

## Listen & Strukturen

- Verwende `<ol>` oder `<ul>` für Listen, nicht gestapelte `<div>`.
- Konversationen: `<ol role="log">` mit `<li>` pro Nachricht.
- Quick-Actions / Chips: `<div role="group" aria-label="…">` mit `<button>`-Elementen darin.

## Test-Checklist

- Tab-Navigation funktioniert in logischer Reihenfolge.
- Alle interaktiven Elemente sichtbar fokussierbar.
- Screenreader (VoiceOver / NVDA) liest jedes Element korrekt.
- `prefers-reduced-motion`-Modus deaktiviert alle Endlos-Animationen.
- Kontrast aller Textfarben mindestens 4.5:1 (normaler Text) bzw. 3:1 (groß ab 18 pt / 14 pt bold).
- Kontrast aller UI-Komponenten und grafischen Objekte mindestens 3:1.
