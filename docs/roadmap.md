# Roadmap

Grober Fahrplan für `Weyouze Anything`. Diese Datei ersetzt den bisherigen
Abschnitt „Aktueller Stand“ im README als Ort für die **große Linie**.

Für **konkrete, abarbeitbare Aufgaben** (Bugs, einzelne Features, Aufgaben)
werden [GitHub Issues](https://github.com/kkrafft1999/weyouze/issues)
verwendet — dafür gibt es Vorlagen für 🐛 Bugs und 💡 Feature-Ideen. Der
Status einzelner Issues lässt sich im zugehörigen
[GitHub Project](https://github.com/kkrafft1999/weyouze/projects) als
Kanban-Board verfolgen (Spalten: *Backlog* → *To do* → *In Progress* → *Done*).

Solange eine Aufgabe noch nicht als Issue angelegt ist (z. B. weil gerade
kein Schreibzugriff auf GitHub besteht), wird sie zwischenzeitlich in
[`docs/task.md`](./task.md) gesammelt und beim Anlegen des Issues dort
wieder entfernt.

> Kurz gesagt: **Diese Datei = Wohin geht's grundsätzlich. Issues = Was ist
> gerade konkret zu tun. `task.md` = Warteschlange für Aufgaben, die noch
> kein Issue sind.**

## ✅ Bereits umgesetzt

- 🗂️ Datei-Explorer für einen frei wählbaren Projektordner inkl. Verlauf
  zuletzt geöffneter Ordner
- 💬 Chat mit Workspace-Kontext (Modell kann Dateien lesen, Verzeichnisse
  listen, im Projekt arbeiten)
- 🔌 Mehrere LLM-Provider: OpenAI, Anthropic, Google (Gemini), Ollama (lokal)
- 🔐 API-Keys lokal & verschlüsselt über Electrons `safeStorage`
- 🧰 Tool-Use-Loop mit eingebauten Workspace-Tools (`list_directory`,
  `read_file_text`, optional `write_file_text`, …)
- 🔔 Update-Notifier (Stufe 1) über GitHub Releases
- 🖥️ Builds für macOS (Apple Silicon) und Windows über Electron Forge
- 📜 Gemeinsame **Contract-Schicht** (`src/shared/contracts/`): versionierte
  DTOs/Events, Enums und Validatoren für Chat, Streaming, Tools und Token-Usage
  — Single Source of Truth für Main (require) und Renderer (generiertes
  ESM-Bundle); beseitigt die doppelte Usage-/`debug_wait`-Logik (Etappe 1)

## 🚧 Jetzt / als Nächstes

- 🏗️ **Saubere, frontend-unabhängige Anwendungsarchitektur** als Grundlage
  für Provider, Tools, Skills und weitere funktionale Module:
  1. ✅ **Stabile Verträge definieren:** versionierte DTOs und Events für Chat,
     Streaming, Tools und Token-Usage liegen als gemeinsame Contract-Schicht
     (`src/shared/contracts/`) vor; Main und Renderer sind daran gebunden.
     Offen: DTOs für die Einstellungen (Provider-/Preset-/UI-Prefs) ergänzen.
  2. ✅ **Anwendungs-Core extrahieren:** Chat-Orchestrierung, Tool-Schleife und
     Workspace-Kontext liegen in `src/main/chat-engine.js` und sind ohne
     UI-/Electron-Abhängigkeit testbar; `chat-handlers.js` ist ein dünner
     IPC-Adapter.
  3. **Provider und Tools über Ports anbinden:** Registries und Adapter hinter
     klaren Schnittstellen kapseln; provider- und tool-spezifisches Wissen aus
     dem Frontend entfernen
  4. **Infrastruktur abgrenzen:** Dateisystem, Storage, Netzwerk, Whisper und
     Updates als austauschbare Adapter des Anwendungs-Cores behandeln
  5. **Frontend zur reinen Präsentationsschicht machen:** Der Renderer erhält
     nur normalisierte Anzeige-Daten und löst Aktionen über die Preload-/IPC-
     Schnittstelle aus
- 🧩 Erweiterbares **Skill-Konzept** (Konfiguration + dynamisches Laden)
- 🛠️ Erweiterbares **Tool-Konzept** über das bestehende Workspace-Tool-Set
  hinaus

## 💡 Später / Ideen

- 🎯 **Use-Case-Profile**, die Plattform + Skills + Tools zu einer
  dedizierten Anwendung bündeln (z. B. HR-, IT-, Büro-Profile aus der
  README-Vision)
- 🔏 Code-Signing für macOS/Windows-Builds (Gatekeeper/SmartScreen entfällt)

## Workflow-Hinweise

- Neue Idee / Bug → als [Issue](https://github.com/kkrafft1999/weyouze/issues/new/choose)
  anlegen (Template wählen).
- Größere Themen aus dieser Roadmap werden bei Bedarf in mehrere Issues
  aufgeteilt, sobald sie konkret angegangen werden.
- Empfohlene Labels: `bug`, `enhancement`, `docs`, `good first issue`.
  Milestones können pro Release (`vX.Y.Z`) angelegt werden, siehe
  [`release.md`](./release.md).
- Diese Datei wird nur bei größeren Verschiebungen der Gesamtrichtung
  aktualisiert, nicht für jede einzelne Aufgabe.
