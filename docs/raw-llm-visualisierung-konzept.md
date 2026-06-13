# Konzept: Visualisierung des LLM-Ablaufs (RAW-LLM-Protokoll)

> **Status: Konzept-Phase, iterativ.** Dieses Dokument ist die gemeinsame
> Denkgrundlage. Wir klären *erst* das Konzept, bevor weiter programmiert wird.
> Offene Entscheidungen stehen unten unter „Offene Fragen“.

---

## 1. Das eigentliche Ziel

Im RAW-LLM-Protokoll soll man pro **Nutzeranfrage** verstehen, **was zwischen
Anwendung und Sprachmodell hin und her geht**. Die bisherigen Darstellungen
(Liste, dann Sequenzdiagramm) treffen den Kern noch nicht — deshalb dieser
Schritt zurück.

Bevor wir eine Darstellung wählen, muss klar sein: **Welche Frage soll der Nutzer
in einem Blick beantworten können?** (siehe Abschnitt 5 — das müssen wir
gemeinsam festlegen).

---

## 2. Mentales Modell, das die Darstellung transportieren muss

Diese Wahrheiten sind bisher nicht klar rübergekommen und müssen es:

1. **Eine Nutzeranfrage = mehrere LLM-Runden.** Jede Runde ist *ein*
   Request/Response-Paar: Anwendung → Modell und zurück.
2. **Das Modell führt nichts aus.** Es liefert nur Text zurück — entweder eine
   Antwort, oder ein **JSON, das einen gewünschten Tool-Aufruf beschreibt**.
3. **Die Anwendung führt das Tool aus** und reicht das Ergebnis in der nächsten
   Runde nach.
4. **Die LLM-API ist zustandslos.** Jede Runde sendet den **kompletten bisherigen
   Verlauf** erneut: System-Prompt + Nutzereingabe + alle bisherigen
   Modell-Antworten (inkl. Tool-Aufruf-JSON) + alle Tool-Ergebnisse.
   → Der „Payload“ **wächst** von Runde zu Runde.

Punkt 4 ist vermutlich der schwierigste Aha-Moment und der, der bei einem reinen
Pfeil-Sequenzdiagramm am wenigsten sichtbar wird.

---

## 3. Welche Daten liegen bereits vor

Pro Runde (`rawExchange`) ist im Renderer vorhanden:

| Feld | Inhalt |
|------|--------|
| `providerId`, `model` | Welches Modell |
| `round`, `ts` | Rundennummer, Zeitstempel |
| `messages` | **Vollständiger** gesendeter Verlauf (System/User/Assistant/Tool), kanonisch |
| `response` | Geparste Modell-Antwort: `{ text, toolCalls:[{name,arguments}] }` |
| `usage` | Token (prompt/completion) |
| `request`, `responseRaw` | Rohdaten (Provider-Body + roher Stream) |
| `error`, `cancelled` | Fehler-/Abbruchstatus |

Gruppiert wird in `appStore.rawLlmLog` als Liste von **Anfragen (Turns)**:
`{ index, userText, exchanges:[...] }`.

→ Datenseitig haben wir alles, auch um das **Anwachsen** des Kontexts und
**Token-Verbrauch** je Runde zu zeigen.

---

## 4. Kandidaten-Darstellungen (zum Vergleichen)

### A) Sequenzdiagramm (aktueller Stand)
Lebenslinien Anwendung/Modell/Tool, chronologische Pfeile.
- ➕ Zeigt Reihenfolge und Rollen des Austauschs gut.
- ➖ Zeigt das **Anwachsen** des Payloads schlecht (Pfeil = Moment, nicht Menge).
- ➖ Bei vielen Runden/Tools schnell hoch und unübersichtlich.

### B) Akkumulierender Kontext-Stapel
Pro Runde eine Spalte/Karte, die den gesendeten Verlauf als **Stapel von
Nachrichten-Blöcken** zeigt. Neue Blöcke kommen je Runde unten dazu → man *sieht*
den Kontext wachsen. Antwort der Runde hängt als neuer Block an.
- ➕ Macht „alles wird erneut gesendet, es wächst“ sofort sichtbar.
- ➕ Token-Balken je Runde leicht integrierbar.
- ➖ Breiter Platzbedarf; Redundanz (gleiche Blöcke je Runde) muss elegant gelöst
  werden (z. B. „bekannt“ vs. „➕ neu“).

### C) Chronologisches Ledger / Transkript
Eine einzige durchlaufende Zeitleiste von Ereignissen (gesendet → geantwortet →
Tool ausgeführt → …), kompakt, mit Klapp-Details.
- ➕ Einfach, linear lesbar, wenig Platz.
- ➖ „Hin und Her“ und Rollen weniger plakativ als ein Diagramm.

### D) Kombination
Schlanke Zeitleiste (C) **oben als Überblick**, Klick öffnet Detail; optional ein
kleiner „Kontext wächst“-Indikator (Token-/Nachrichten-Balken je Runde aus B).

---

## 5. Offene Fragen (die wir zuerst klären)

1. **Primärziel der Visualisierung?** (didaktisch verstehen, wie ein Agent
   tickt? / Debugging, was genau rausging? / Kontext- & Token-Wachstum sehen? /
   Tool-Nutzung auditieren?)
2. **Welche Darstellung trifft dein Bild am ehesten?** (A Sequenz / B
   Kontext-Stapel / C Ledger / D Kombination / etwas ganz anderes?)
3. **Wie wichtig ist, das *Anwachsen des Kontexts* sichtbar zu machen?**
4. **Detailtiefe:** reicht „Snippet + Klick für Volltext“, oder willst du Inhalte
   direkt sehen?

---

## 6. Nächste Schritte

1. Fragen aus Abschnitt 5 beantworten (grob reicht).
2. Eine Richtung wählen → hier als **Skizze/Pseudo-Layout** festhalten
   (ggf. als statisches Mockup), noch ohne echten Code.
3. Erst wenn die Skizze sitzt: implementieren.

---

## 7. Verlauf der Iteration

- *(wird fortgeschrieben)* — v0: Liste, dann Sequenzdiagramm gebaut; Kern noch
  nicht getroffen → Schritt zurück ins Konzept.
