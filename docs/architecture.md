# Architektur

Kurzüberblick zur Schichten- und Port/Adapter-Struktur von Weyouze Anything
nach Abschluss der fünf Roadmap-Etappen (Stand 2026-07-12). Diagramme:
[`architecture-layers.svg`](./architecture-layers.svg),
[`architecture-hexagonal.svg`](./architecture-hexagonal.svg),
[`architecture.svg`](./architecture.svg).

## Abhängigkeitsrichtung

Abhängigkeiten zeigen **immer nach innen** — vom äußeren Rand (UI, IPC,
Infrastruktur) zum transport-agnostischen Kern:

```
Renderer / Preload / IPC-Handler
        ↓
Main-Adapter & Composition (src/main/adapters/, composition/)
        ↓
Anwendungs-Core (src/application/)
        ↓
Shared Contracts & Runtime (src/shared/contracts/, runtime/)
```

Der Anwendungs-Core (`src/application/`) importiert nur Module unter
`src/application/` und `src/shared/`. Er kennt weder Electron noch
Provider-Implementierungen noch das Dateisystem.

## Schichten

| Schicht | Pfad | Rolle |
| ------- | ---- | ----- |
| **Contracts** | `src/shared/contracts/` | Versionierte DTOs, Events, Enums, Validatoren für die IPC-Grenze und Persistenz |
| **Presentation (shared)** | `src/shared/presentation/` | Domänennahe Anzeige-Helfer für Main-Adapter und Tests (z. B. Tool-Zeilen); nicht vom Core importiert |
| **Application** | `src/application/chat/`, `src/application/ports/` | Chat-Orchestrierung, Tool-Schleife, Verlaufstrim — nur über injizierte Ports |
| **Main adapters** | `src/main/adapters/` | Konkrete Port-Implementierungen (LLM, Tools, Storage, FS, Speech, Updates, …) |
| **Main ports** | `src/main/ports/` | Schnittstellen-Typen für Infrastruktur (schmale Oberflächen, keine Leaks) |
| **Composition root** | `src/main/composition/` | Verdrahtung: `createApplication()` baut Services, Adapter und Engine, registriert IPC |
| **IPC** | `src/main/ipc/` | Dünne treibende Adapter: IPC ↔ Use-Case-Aufrufe, Event-Push an den Renderer |
| **Renderer** | `src/renderer/` | Reine Präsentation: DOM, CSS, lokale Formatierung; nur `window.electronAPI` + Contracts |

Legacy-Re-Exports unter `src/main/chat-engine.js` und
`src/main/chat-history-trim.js` leiten auf `src/application/chat/` weiter, damit
bestehende Importe stabil bleiben.

## Ports

**Anwendungs-Ports** (`src/application/ports/`) — vom Chat-Core konsumiert:

- `llm-port` — Streaming-Runden gegen einen Provider
- `tool-port` — Tool-Registry und Ausführung
- `chat-preferences-port` — UI-Prefs, System-Prompt, Tool-Runden-Limit
- `workspace-path-port` — Pfad-Helfer (z. B. `basename`)
- `raw-exchange-port` — RAW-Protokoll-Aufzeichnung je Runde

**Infrastruktur-Ports** (`src/main/ports/`) — von Adaptern implementiert,
über Composition injiziert:

- Storage: `llm-config-store-port`, `ui-prefs-store-port`,
  `chat-history-store-port`, `workspace-folder-store-port`,
  `provider-secrets-port`
- Laufzeit: `provider-runtime-port`, `provider-catalog-port`,
  `provider-model-listing-port`, `credential-port`, `filesystem-port`,
  `speech-port`, `update-port`

## Composition root

`src/main/composition/create-application.js` ist der zentrale Einstieg nach dem
Electron-Bootstrap:

1. Erzeugt Infrastruktur-Services (`storage-service`, `fs-service`, …)
2. Wickelt sie in schmale Port-Adapter (`persistence-store-adapters`, …)
3. Baut die Chat-Anwendung via `create-chat-application.js` (LLM-, Tool-,
   Preferences-Adapter → `createChatEngine`)
4. Registriert IPC-Handler mit injizierten Abhängigkeiten

`src/main/index.js` ruft nur `createApplication()` auf — keine verstreute
Verdrahtung in den Handlern.

## Renderer: was verschoben wurde, was bleibt

**Aus dem Renderer entfernt** (jetzt Main oder `shared/`):

- Provider-/Preset-Formularsemantik → `settings-presentation-service` +
  `shared/contracts/settings.js`
- Tool-Anzeigezeilen → `shared/presentation/tool-display.js` (über Tool-Port-Adapter)
- RAW-Log-View-Model → `raw-log-presentation-service` + `shared/contracts/raw-log.js`
- Verlaufs-Normalisierung (Titel, Sanitisierung, Usage) →
  `chat-history-normalization.js`

**Legitim im Renderer** (Präsentation, kein Domänenwissen):

- Markdown-Rendering und HTML-Sanitisierung (`marked`, `DOMPurify`)
- DOM-Aufbau für Chat, Tool-Zeilen, Modals
- Lokale Zeit-/Datumsformatierung (`messageUtils.formatHistoryTime`)
- Anzeige vorgefertigter DTO-Felder (`entry.line`, `providers[].presetFields`)

Der Renderer **darf** Provider-IDs und Preset-Felder aus IPC-DTOs *anzeigen*,
solange er keine Provider-Wire-Formate parst und keine Tool-/Provider-Logik
dupliziert.

## Automatisierte Grenzwächter

| Test | Was er prüft |
| ---- | ------------ |
| `test/application-layer-imports.test.js` | `src/application/` importiert nur `application/` + `shared/` |
| `test/infrastructure-boundaries.test.js` | Storage/Credentials ohne Provider-Registry-Leaks |
| `test/adapter-port-shapes.test.js` | Port-Adapter exponieren nur erlaubte Methoden |
| `test/contracts*.test.js` | Wire-Enums und Settings-DTOs an der IPC-Grenze |
| `test/*-presentation.test.js`, `test/chat-history-normalization.test.js` | Normalisierte Anzeige-Daten für Settings, RAW-Log, Verlauf |

## Weitere funktionale Module (noch offen)

Skills, erweiterte Tool-Sets und Use-Case-Profile sind **nicht** Teil der
abgeschlossenen Architektur-Etappen — sie bauen auf dieser Struktur auf, sind
aber in [`roadmap.md`](./roadmap.md) weiterhin als nächste Schritte geführt.
