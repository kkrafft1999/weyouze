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

### Website für weyouze.dev: Produkt bewerben & Download anbieten

- **Problem/Use Case:** Aktuell gibt es keinen öffentlichen, zentralen Ort,
  an dem Interessenten Weyouze Anything kennenlernen können. Die Domain
  `weyouze.dev` ist dafür vorgesehen, wird aber noch nicht genutzt.
  Downloads liegen bisher nur auf der GitHub-Releases-Seite, was für
  Außenwirkung/Marketing wenig einladend ist und keine Produktvorstellung
  (Vision, Screenshots, Use Cases) bietet.
- **Vorschlag:** Landingpage unter `weyouze.dev` mit
  - kurzer Produktbeschreibung/Vision (siehe README),
  - Screenshots bzw. kurzer Demo,
  - Download-Buttons für die aktuellen Builds (macOS/Windows), z. B.
    verlinkt auf die neuesten GitHub Releases,
  - optional: Link zu Changelog/Release-Notes.

  Technischer Ansatz (statische Seite, Framework, Hosting) ist offen und
  kann bei Bedarf in einem eigenen Umsetzungs-Issue konkretisiert werden.
- **Bereich:** Sonstiges
- **Alternativen:** Nur die GitHub-Releases-Seite als Download-Ort nutzen
  (aktueller Zustand) — funktional ausreichend, aber ungeeignet zur
  Produktbewerbung nach außen.
- **Label:** `enhancement`
- **Status:** Issue-Text vorbereitet (2026-07-01), noch nicht als GitHub
  Issue angelegt.
