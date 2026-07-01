# Weyouze Anything

> **WeUseAnything** – eine Electron-basierte Plattform, die per **Skills** und **Tools** zu Use-Case-spezifischen KI-Anwendungen ausgebaut werden kann.

## Vision

`Weyouze Anything` (gesprochen: *"We Use Anything"*) ist bewusst **kein** fertig zugeschnittenes Produkt, sondern eine **Plattform**:

- Die Electron-App liefert das Fundament: Fenster, Datei-Explorer, Chat-UI, Provider-Anbindung, sicheres Speichern von Keys, Tool-Use-Loop.
- Darauf aufgesetzt werden **Skills** (vorgefertigte Arbeitsweisen, Prompts, Abläufe) und **Tools** (konkrete Aktionen, die das Modell ausführen kann) – **dynamisch oder per Konfiguration**.
- So entstehen aus *einem* Basis-Programm viele **Use-Case-spezifische Anwendungen**:
  - 🏢 **Büroarbeit:** Angebote erstellen, Kampagnen planen, Präsentationen vorbereiten
  - 👥 **HR:** Stellenausschreibungen, Onboarding-Pakete, Mitarbeiterkommunikation
  - 🖥️ **IT:** Runbooks, Incident-Begleitung, Doku-Pflege
  - 👩‍💻 **Software-Engineering:** projektbezogene Code- und Repo-Assistenz

Der Name betont den Plattform-Charakter: *"Wir nutzen alles"* – jedes Modell, jeden Workspace, jeden Skill, jedes Tool.

> Status: **persönliches Hobby- / Experimentier-Projekt.** Schnittstellen, UI und Konfiguration können sich jederzeit ändern.

## Aktueller Stand

Bereits umgesetzt:

- 🗂️ **Datei-Explorer** für einen frei wählbaren Projektordner inkl. Verlauf zuletzt geöffneter Ordner
- 💬 **Chat mit Workspace-Kontext** – das Modell kann Dateien lesen, Verzeichnisse listen und im Projekt arbeiten
- 🔌 **Mehrere LLM-Provider:** OpenAI, Anthropic, Google (Gemini), Ollama (lokal)
- 🔐 **API-Keys lokal & verschlüsselt** über Electrons `safeStorage`
- 🧰 **Tool-Use-Loop** mit eingebauten Workspace-Tools (`list_directory`, `read_file_text`, optional `write_file_text`, …)
- 🖥️ Builds für **macOS (Apple Silicon)** und **Windows** über Electron Forge

In Arbeit / geplant (siehe Vision):

- 🧩 Erweiterbares **Skill-** und **Tool-Konzept** (Konfiguration + dynamisches Laden)
- 🎯 **Use-Case-Profile**, die Plattform + Skills + Tools zu einer dedizierten Anwendung bündeln

## Tech-Stack

- [Electron](https://www.electronjs.org/) (Main + Renderer + Preload)
- [Electron Forge](https://www.electronforge.io/) für Packaging & Maker (DMG / ZIP)
- Vanilla JS im Renderer + [`marked`](https://github.com/markedjs/marked) und [`DOMPurify`](https://github.com/cure53/DOMPurify) für Markdown
- [`@fontsource/inter`](https://fontsource.org/fonts/inter) als Schriftart

## Voraussetzungen

- **Node.js** ≥ 18 (empfohlen: aktuelle LTS)
- **npm** (kommt mit Node)
- macOS oder Windows
- Optional: API-Key für OpenAI / Anthropic / Google bzw. ein lokales [Ollama](https://ollama.com/)

## Schnellstart

```bash
# Repository klonen
git clone git@github.com:<dein-user>/weyouze.git
cd weyouze

# Abhängigkeiten installieren
npm install

# App im Entwicklungsmodus starten
npm start
```

Beim ersten Start kannst du in den Einstellungen einen Provider wählen und deinen API-Key eintragen. Der Key wird verschlüsselt im Benutzerprofil deines Betriebssystems abgelegt – er landet **nicht** im Projektordner und nicht im Repository.

## App bauen / paketieren

```bash
# macOS (Apple Silicon) – DMG + ZIP
npm run make

# Nur paketieren ohne Installer
npm run package         # macOS arm64
npm run package:win     # Windows x64
```

Die fertigen Artefakte landen im Ordner `out/` (per `.gitignore` ausgeschlossen).

## Konfiguration

Die meisten Einstellungen (Provider, Modelle, System-Prompt, Sprache) pflegst du direkt in der App unter **Einstellungen**. Darüber hinaus liegen im Benutzerprofil (`userData`-Ordner von Electron) ein paar JSON-Dateien, u. a. `ui-preferences.json` mit folgenden Optionen:

| Schlüssel          | Bedeutung                                                                  | Default   | Bereich          |
| ------------------ | -------------------------------------------------------------------------- | --------- | ---------------- |
| `maxToolRounds`    | Maximale Tool-Runden pro Chat-Anfrage (auch in der App einstellbar)         | 14        | 1 – 500          |
| `historyCharLimit` | Zeichen-Budget für den an den Provider gesendeten Chat-Verlauf (siehe unten)| 200 000   | 4 000 – 2 000 000 |
| `allowWorkspaceWrite` | Schaltet das Tool `write_file_text` frei (Einstellungen › Tools); ohne diese Option kann das Modell Dateien nur lesen | `false` | – |

**Verlaufs-Trimming (`historyCharLimit`):** Damit lange Sessions nicht ins Token-Limit des Providers laufen, wird der Verlauf pro Anfrage budgetiert (Heuristik: 1 Token ≈ 4 Zeichen). Ältere Nachrichten jenseits des Budgets werden weggelassen, und große Tool-Ausgaben früherer Tool-Runden (z. B. gelesene Dateien) werden auf einen Platzhalter gekürzt. Die aktuelle Frage, alle User-Nachrichten im Fenster und die Tool-Ausgaben der jüngsten Runde bleiben immer vollständig erhalten.

**Schreibzugriff (`write_file_text`):** Standardmäßig kann das Modell im Workspace nur lesen. Wird `allowWorkspaceWrite` aktiviert, kommt zusätzlich `write_file_text` zum Einsatz — das Modell kann damit Textdateien im geöffneten Projektordner anlegen oder komplett überschreiben (max. 2 MB, fehlende Zwischenordner werden automatisch erzeugt). Der Zugriff bleibt wie bei den Lese-Tools strikt auf den Projektordner beschränkt.

## Projektstruktur

```
.
├── src/
│   ├── main/            Electron Main-Prozess (Fenster, Permissions, Workspace-State)
│   │   ├── ipc/         IPC-Handler (Chat, Settings, Dateisystem, Chat-History)
│   │   ├── providers/   Adapter für OpenAI, Anthropic, Google, Ollama, MLX-LM
│   │   └── services/    Storage (Keys, Prefs, History) & Dateisystem-Zugriff
│   ├── preload/         sichere Bridge zwischen Main und Renderer (gebundelt)
│   ├── renderer/        UI (HTML, CSS, JS) – läuft im Browser-Kontext
│   └── shared/          gemeinsame Definitionen (z. B. IPC-Kanäle)
├── test/                Tests (node:test)
├── scripts/             Build-Helfer (z. B. Vendor-Sync für den Renderer)
├── docs/                interne Notizen & UI-Designs
├── icon.icns / icon.ico App-Icons für macOS / Windows
└── package.json
```

## Sicherheitshinweise

- API-Keys werden **lokal** gespeichert und nicht an Dritte weitergegeben.
- Der Workspace-Zugriff der Tools ist auf den jeweils geöffneten Projektordner beschränkt.
- Schreibzugriff (`write_file_text`) ist standardmäßig **deaktiviert** und muss bewusst unter Einstellungen › Tools aktiviert werden.
- Trotzdem gilt: lass das Modell nichts in Ordnern arbeiten, in denen sensible Daten liegen, denen du nicht traust.

## Lizenz

Apache License 2.0 – siehe [`LICENSE`](./LICENSE).

Copyright © 2026 Konrad Krafft.
