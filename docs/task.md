# Task-Inbox

Diese Datei ist eine **Zwischenablage** für konkrete Aufgaben, die noch
**nicht** als [GitHub Issue](https://github.com/kkrafft1999/weyouze/issues)
existieren — z. B. weil in der aktuellen Arbeitsumgebung nur lesender
`gh`-Zugriff besteht und Issues nicht direkt per CLI angelegt werden können.

> **Nicht verwechseln mit [`roadmap.md`](./roadmap.md):** Die Roadmap
> beschreibt die grobe Richtung (Vision, große Themen, „Jetzt“/„Später“).
> `task.md` sammelt einzelne, abarbeitbare Aufgaben nur so lange
> **zwischen**, bis sie als Issue existieren.

## Workflow

1. **Neue Aufgabe** kommt im Gespräch oder bei der Arbeit auf → hier als
   Eintrag mit fertigem Issue-Text ergänzen (Titel, Problem/Use Case,
   Vorschlag, Label) — idealerweise direkt in der Form, die man 1:1 in ein
   GitHub Issue übernehmen kann.
2. **Regelmäßig synchronisieren**: Vor größeren Antworten zum Thema
   Aufgaben/Backlog (oder wenn explizit danach gefragt wird) mit den
   GitHub Issues abgleichen, z. B.:

   ```sh
   gh issue list --repo kkrafft1999/weyouze --state all
   ```

3. **Sobald aus einem Eintrag ein GitHub Issue geworden ist** (von einer
   Person manuell angelegt oder von einem Agent mit Schreibzugriff
   erstellt), wird der Eintrag hier **gelöscht**. Das Issue ist dann die
   einzige Quelle der Wahrheit — kein Duplikat in `task.md` behalten.
4. Bleibt eine Aufgabe offen und es existiert (noch) kein Issue dafür,
   bleibt sie einfach in dieser Datei stehen, bis sie angelegt wird.

## Offene Einträge (noch kein GitHub Issue)

### 💡 Anwendungs-Core aus dem Chat-IPC-Handler extrahieren (Roadmap-Etappe 2)

**Label:** `enhancement`

**Problem / Kontext**

Die komplette Chat-Orchestrierung (Runden-Schleife, Tool-Dispatch, Abbruch,
Usage-Summierung, RAW-Aufzeichnung, Fortschritts-Push) lebt heute im
Electron-IPC-Handler `src/main/ipc/chat-handlers.js` und ist eng mit dem
Transport verwoben (`event.sender`, `webContents.send`, Push-Kanäle). Dadurch
lässt sich der Kernablauf nur mit Electron-Fakes testen, und die Logik ist nicht
für andere Transporte (CLI, Tests, künftige Automationen) wiederverwendbar.
Roadmap-Etappe 1 (gemeinsame Contract-Schicht unter `src/shared/contracts/`)
ist umgesetzt und liefert bereits die stabilen DTOs/Events als Grundlage.

**Vorschlag / Umsetzung**

- Einen transport-agnostischen `createChatEngine({ providers, toolRegistry, storage, clock })`
  extrahieren, der `messages` + Optionen entgegennimmt und über einen
  injizierten **Event-Sink** (statt `webContents.send`) streamt sowie das
  Ergebnis-DTO aus der Contract-Schicht zurückgibt.
- `chat-handlers.js` wird zum dünnen Adapter: übersetzt IPC-`event`/Abort auf
  Engine-Aufrufe und leitet die Engine-Events über die bestehenden
  Push-Kanäle an den Renderer weiter.
- Wire-Format unverändert lassen (Contract-DTOs/Events aus Etappe 1
  wiederverwenden), damit der Renderer nicht angefasst werden muss.
- Unit-Tests für die Engine **ohne** Electron ergänzen (Runden-Schleife,
  Tool-Loop, Abbruch, Usage-Merge, Fehlerpfade); den vorhandenen
  Handler-Integrationstest schlank halten.

**Nutzen**

Echte Testbarkeit des Kernablaufs ohne Electron, klare Grenze zwischen
Anwendungslogik und Transport, Grundlage für die weiteren Etappen (Ports für
Provider/Tools, Infrastruktur-Adapter, reine Präsentationsschicht).
