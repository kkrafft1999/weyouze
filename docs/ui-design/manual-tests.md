# Manuelle Tests (Phase 5 A)

Diese Tests sind nicht automatisierbar und muessen von Hand am echten System ausgefuehrt werden. Reihenfolge spielt keine Rolle, aber **alle Punkte muessen vor jedem Release abgehakt werden**. Ergebnisse in `checklist.md` eintragen.

Plattform-Annahme: macOS 14+, Electron 41+. NVDA-Tests auf Windows sind optional, aber empfohlen.

---

## 1. VoiceOver-Smoketest (macOS)

**Aktivieren:** Cmd+F5 (oder Systemeinstellungen → Bedienungshilfen → VoiceOver).

### Tab-Navigation

- [ ] Sidebar-Buttons (Folder-History, Open-Folder) werden angesagt.
- [ ] Tree-Items werden mit Datei-/Ordnername angesagt; bei aufklappbaren Ordnern sollte VoiceOver „eingeklappt"/"ausgeklappt" mitlesen (Hinweis: aktuelle Implementation hat noch kein `role=tree` — das steht in `phase-5-review.md` als Soll-Punkt).
- [ ] Chat-Panel: Live-Dot wird je nach State angesagt:
  - „Verbindung aktiv" (wenn Provider konfiguriert, idle).
  - „Modell antwortet" (waehrend Streaming).
  - „Kein KI-Anbieter konfiguriert" (Welcome ohne Settings).
- [ ] Chat-Header-Titel (Projektname) wird ohne `lang`-Attribut deutsch ausgesprochen.
- [ ] Modell-Pille wird **englisch** ausgesprochen (`lang="en"` greift).
- [ ] Chat-History- und Settings-Buttons mit Icon-Label korrekt.
- [ ] Eingabefeld als „Nachricht, Textfeld" angesagt.

### Konversation

- [ ] `<ol id="chat-messages" role="log">` wird als „Liste, n Eintraege" angekuendigt.
- [ ] User-Nachricht und Assistant-Nachricht werden als getrennte Listen-Eintraege gelesen.
- [ ] Tool-Aufruf:
  - Pille `RUNNING` wird **englisch** vorgelesen + Praefix „Status:" (durch sr-only).
  - Pille `DONE` analog.
- [ ] Error-Bubble wird mit „Achtung Fehler" oder dem Glyph-Vorlesetext gestartet (`⚠ Fehler:` ist als sichtbarer Text Teil des Bubble — Praefix kommt aus `::before`-Pseudo-Element, das **manche** Screenreader nicht lesen; falls nicht, ist der Inhalt selbsterklaerend).

### Provider-Modal

- [ ] Beim Oeffnen springt der Fokus auf das erste Element (Provider-Select).
- [ ] Tab-Navigation rotiert nur **innerhalb** des Modals (Focus-Trap aus Phase 5).
- [ ] Escape schliesst das Modal, Fokus wandert zurueck auf das Zahnrad-Icon.
- [ ] `aria-modal="true"` ist gesetzt (Phase 5).
- [ ] Provider-Optionen werden englisch vorgelesen (`OpenAI`, `Anthropic`, …).
- [ ] Modell-Optionen ebenfalls englisch.

### Welcome-Bereich

- [ ] „WEYOUZE" wird englisch ausgesprochen.
- [ ] Welcome-Headline H1 wird als Ueberschrift angekuendigt.
- [ ] Quick-Action-Chips werden mit Cmd-Name (analyse, review, …) **englisch** und der Beschreibung deutsch vorgelesen.
- [ ] Recent-Folders-Chips: Ordner-Name und Pfad werden vorgelesen.

---

## 2. axe DevTools (Electron-Renderer)

**So oeffnen:** `Ansicht` → `Entwicklertools` (Electron) → `axe DevTools`-Tab. Falls die Extension fehlt, im Browser-Profil installieren — sie wird automatisch in den Electron-DevTools angezeigt.

**Soll-Zustand:**

- [ ] Kategorie `color-contrast`: 0 Errors.
- [ ] Kategorie `focus-visible`: 0 Errors.
- [ ] Kategorie `motion`: 0 Errors.
- [ ] Kategorie `aria-*`: 0 Errors (Modal, Live-Region).
- [ ] Erlaubte Warnings: maximal 5 Best-Practice-Hinweise, jeder begruendet im Log.

---

## 3. Lighthouse Accessibility

**So oeffnen:** Electron-DevTools → `Lighthouse`-Tab → Modus „Navigation", Kategorie nur „Accessibility", Geraet „Desktop".

**Soll-Zustand:**

- [ ] Score ≥ 95.
- [ ] Keine Faktoren bei 0 Punkten.
- [ ] Bei Score < 95: Audit-Liste durchsehen, jede Findung in Issue oder Phase-6-Backlog ueberfuehren.

---

## 4. Reduced-Motion-Test

**Aktivieren:** Systemeinstellungen → Bedienungshilfen → Anzeige → „Bewegung reduzieren" einschalten.

- [ ] Live-Dot pulst **nicht** mehr (data-state=live, kein animation).
- [ ] Mic-Recording pulst **nicht** mehr (Animation aus, Farbe bleibt).
- [ ] Chat-Phase-Pulse („Modell denkt nach …") laeuft **nicht** mehr, opacity bleibt statisch bei 0.7.
- [ ] Tool-Hero-Fade-In ist auf 0,001s reduziert (kein sichtbarer Flicker).
- [ ] Tool-Status-Dot pulst **nicht**.
- [ ] Streaming verhaelt sich sonst identisch.

Anschliessend Reduced-Motion **wieder ausschalten** und gegenpruefen, dass alle Animationen wieder laufen.

---

## 5. Dark-Mode-Durchlauf

Theme-Toggle in der Titlebar einmal anklicken. Komponenten einzeln pruefen:

- [ ] Live-Dot in allen drei Stati lesbar (live cyan, streaming cyan, offline grau).
- [ ] Tool-Hero (RUNNING): linker Cyan-Border sichtbar, Pille lesbar, Live-Dot pulst.
- [ ] Tool-Compact (DONE): linker --ds-blue-Border sichtbar, Pille lesbar, Check-Icon kontrastiert.
- [ ] User-Bubble: Border + Cyan-Akzent links sichtbar.
- [ ] Welcome:
  - Eyebrow `// WEYOUZE` lesbar.
  - Headline H1 (700 Heavy) bleibt scharf.
  - Recent-Folder-Chips Border kontrastiert mit dem Hintergrund.
  - Quick-Action-Chips desgleichen.
- [ ] Settings-Modal:
  - Backdrop-Abdunkelung deutlich.
  - Inputs lesbar, Hint-Text kontrastiert.
  - Buttons (Primary + zwei Sekundaer) kontrastieren.
- [ ] Sidebar Tree-Header: Eyebrow `// projekt` lesbar, Project-Name hat Bold-Inter.
- [ ] File-Preview-Header: Mono-Filename + Pille rechts sind klar sichtbar.

**Hilfsmittel:** Im DevTools `Rendering`-Tab `Emulate CSS color-gamut: srgb` + `Emulate vision deficiencies: blurred vision` checken — die App sollte trotzdem nutzbar bleiben.

---

## 6. Screenshots-Ablage

Anleitung in `docs/ui-design/screenshots/README.md`. Pro Theme drei Hauptzustaende:

- [ ] welcome-light.png + welcome-dark.png
- [ ] streaming-tool-run-light.png + streaming-tool-run-dark.png
- [ ] done-answer-light.png + done-answer-dark.png

---

## 7. Checklist-Nachpflege

Nach den Tests `docs/ui-design/checklist.md` durchgehen und Haken setzen oder Issues nachziehen.
