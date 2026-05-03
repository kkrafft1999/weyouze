# Weyouze UI-Screenshots

Ablage fuer die in `phase-5-backlog.md` Abschnitt A geforderten Vorher/Nachher-Screenshots der drei Hauptzustaende.

## Soll-Zustand

Pro Theme (Light + Dark) jeweils:

- `welcome-light.png` / `welcome-dark.png` — Empty-Welcome-State (kein Ordner geoeffnet, mit Recent-Folders + Quick-Actions ab Phase 5).
- `streaming-tool-run-light.png` / `streaming-tool-run-dark.png` — Aktiver Tool-Run mit Hero-Karte und Live-Dot.
- `done-answer-light.png` / `done-answer-dark.png` — Fertige Assistant-Antwort mit Tool-Compact in DONE-Zustand.

## So entstehen die Screenshots

1. App im Light-Theme starten.
2. Settings-Modal: einen Provider mit Key konfigurieren.
3. Ordner oeffnen, der mehrere Files enthaelt (z. B. dieses Repo selbst).
4. Eine Frage stellen, die einen Tool-Aufruf ausloest (z. B. „Was ist in package.json?").
5. Cmd+Shift+4, Bereich des Chat-Panels markieren, abspeichern unter `streaming-tool-run-light.png`.
6. Nach Antwort-Ende: noch einmal screenshotten als `done-answer-light.png`.
7. Theme-Toggle, Schritte 4–6 in Dark wiederholen.
8. Bei den Welcome-Screenshots: in den Settings „Anbieter zuruecksetzen" klicken oder einen Workspace mit leerer Folder-History oeffnen.

## Format

- PNG, mindestens 1280x800 (App-Default).
- Klartext-Filenames ohne Sonderzeichen, alle Lowercase, mit `-` als Trenner.
- Keine personen- oder kundenbezogenen Daten im Bild (Repository-Name, Pfade ggf. anonymisieren).
