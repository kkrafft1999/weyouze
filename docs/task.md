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

### Symlink-Escape bei Workspace-Dateizugriff verhindern

**Problem / Use Case**

Die Pfadprüfung des Datei-Services vergleicht derzeit nur lexikalisch
aufgelöste Pfade. Ein symbolischer Link innerhalb des geöffneten
Projektordners kann deshalb auf ein Ziel außerhalb des Projektordners zeigen.
Die Workspace-Tools könnten darüber Dateien außerhalb des freigegebenen
Ordners lesen oder mit aktiviertem Schreibzugriff verändern.

**Vorschlag**

- Vor Dateioperationen den realen Pfad des Workspace-Roots und des Ziels bzw.
  des nächsten existierenden Elternordners auflösen.
- Zugriffe ablehnen, wenn das reale Ziel außerhalb des realen Workspace-Roots
  liegt.
- Regressionstests für lesende und schreibende Zugriffe über Symlinks
  ergänzen; plattformspezifische Symlink-Einschränkungen berücksichtigen.

**Label:** `bug`
