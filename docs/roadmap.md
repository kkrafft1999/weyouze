# Roadmap

Grober Fahrplan für `Weyouze Anything`. Diese Datei ersetzt den bisherigen
Abschnitt „Aktueller Stand“ im README als Ort für die **große Linie**.

Für **konkrete, abarbeitbare Aufgaben** (Bugs, einzelne Features, Aufgaben)
werden [GitHub Issues](https://github.com/kkrafft1999/weyouze/issues)
verwendet — dafür gibt es Vorlagen für 🐛 Bugs und 💡 Feature-Ideen. Der
Status einzelner Issues lässt sich im zugehörigen
[GitHub Project](https://github.com/kkrafft1999/weyouze/projects) als
Kanban-Board verfolgen (Spalten: *Backlog* → *To do* → *In Progress* → *Done*).

> Kurz gesagt: **Diese Datei = Wohin geht's grundsätzlich. Issues = Was ist
> gerade konkret zu tun.**

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

## 🚧 Jetzt / als Nächstes

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
