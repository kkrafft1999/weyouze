# Konzept: Visualisierung des LLM-Ablaufs (RAW-LLM-Protokoll)

> **Status: Konzept FREIGEGEBEN ✅ — bereit zur Umsetzung.** Richtung, Mockup und
> alle Kern-Entscheidungen sind abgenommen. Die Implementierung erfolgt in einer
> **eigenen Konversation**.

### Start hier (Handoff für die Bau-Konversation)

Dieses Dokument ist die vollständige Vorgabe — es ist ohne Kontext der
Konzept-Konversation umsetzbar. Empfohlene Lesereihenfolge: **Ziel (1) → mentales
Modell (2) → Daten (3) → Leitkonzept + Mockup (5) → Design-Spec (5b) →
Umsetzungs-Skizze (5d) → Akzeptanzkriterien (5e) → Edge-Cases (5f)**. Alle
Entscheidungen stehen gebündelt in Abschnitt 8.

**Kurzfassung:** Im RAW-LLM-Protokoll (`src/renderer/components/RawLogModal.js`)
das bestehende Sequenzdiagramm durch einen **vertikalen Kontext-Schichtstapel**
ersetzen — eine Ansicht, die pro Runde den *komplett erneut gesendeten* Verlauf als
Schicht-Stapel zeigt (alte Schichten grau, neue farbig+➕) mit einem Gesamt-Token-
Balken, der wächst, und einer kleinen Modell-Antwort-Karte rechts. Reiner
Renderer-Umbau, kein Main-/IPC-Eingriff.

---

## 1. Das eigentliche Ziel

Im RAW-LLM-Protokoll soll man pro **Nutzeranfrage** verstehen, **was zwischen
Anwendung und Sprachmodell hin und her geht**. Liste und Sequenzdiagramm trafen
den Kern nicht — daher dieser Konzept-Schritt.

**Priorisierte Ziele (vom Nutzer bestätigt):**
- **P1 (höchste): Didaktisch** — auf einen Blick begreifen, *wie ein
  werkzeugnutzender LLM-Agent funktioniert* (siehe Abschnitt 2).
- **P2:** Kontext-/Token-**Wachstum** sichtbar machen.
- **P3:** Tool-Nutzung **auditierbar** (welches Tool, welche Argumente, welches
  Ergebnis).
- *Debugging (roher Byte-Vergleich) ist NICHT der Fokus.*

---

## 2. Mentales Modell, das die Darstellung transportieren muss

1. **Eine Nutzeranfrage = mehrere LLM-Runden.** Jede Runde = ein
   Request/Response-Paar (Anwendung → Modell und zurück).
2. **Das Modell führt nichts aus.** Es liefert nur Text zurück — eine Antwort
   *oder* ein **JSON, das einen gewünschten Tool-Aufruf beschreibt**.
3. **Die Anwendung führt das Tool aus** und reicht das Ergebnis in der nächsten
   Runde nach.
4. **Die LLM-API ist zustandslos.** Jede Runde sendet den **kompletten bisherigen
   Verlauf** erneut → der Payload **wächst** von Runde zu Runde.

Punkt 4 ist der schwierigste Aha-Moment und der, den ein reines Pfeil-Diagramm am
wenigsten transportiert: Wachstum ist eine **Mengen-Aussage**, kein Ereignis.

---

## 3. Welche Daten liegen bereits vor

Pro Runde (`rawExchange`): `providerId`, `model`, `round`, `ts`, das
**vollständige** gesendete `messages`-Array (system/user/assistant/tool;
assistant kann `tool_calls` haben; tool hat `tool_call_id` + Ergebnis), geparste
`response {text, toolCalls:[{name,arguments}]}`, `usage` (prompt/completion-Token),
Rohdaten (`request`-Body + `responseRaw`-Stream), `error`/`cancelled`. Gruppiert
als `appStore.rawLlmLog = [{ index, userText, exchanges:[...] }]`.

→ Datenseitig ist alles da, auch für Wachstum (P2) und Tool-Audit (P3).
Vorhandener Code in `RawLogModal.js` deckt vieles ab: `prevSentCount`-Diff,
`describeRequest` (➕-Marker für neue Nachrichten), `buildMessageBlock`
(Rollen-Farben), `usageSummary` (Token), `findToolResult` (call-id-Verknüpfung).

---

## 4. Untersuchte Konzepte (5 Entwürfe, bewertet)

| # | Konzept | P1 | P2 | P3 | Aufwand | Score |
|---|---------|----|----|----|---------|-------|
| 1 | **Kontext-Schichtstapel** — Runde = Spalte/Block; alter Sockel blass, Neues leuchtet | 5 | 5 | 4 | hoch | 8 |
| 2 | **Geführte Tour** — Stepper mit Lehrsätzen, „Mappe“ wächst | 5 | 4 | 3 | mittel | 4 |
| 3 | **Swimlane+** — Sequenzdiagramm aufgebohrt (Pfeildicke = Payload) | 5 | 5 | 4 | hoch | 5 |
| 4 | **Kontext-Dashboard** — Balken je Runde, nach Kategorie geschichtet | 4 | 5 | 4 | mittel | 9 |
| 5 | **Akte am Fax** — Alltagsmetapher: ganze Akte wird jede Runde neu gefaxt | 5 | 4 | 4 | mittel | 7 |

Erkenntnisse: #2 dupliziert die bestehende „Ablauf erklären“-Funktion und
skaliert schlecht. #3 ist im Kern das bereits gescheiterte Lebenslinien-Paradigma.
#5 ist die stärkste *Metapher*, aber als Leitbild zu verspielt für Entwickler.
**#4 und #1 sind die zwei Stärksten — und ergänzen sich.**

---

## 5. Empfehlung: Leitkonzept

### „Wachsender Kontext-Schichtstapel“ (vertikal, einspaltig)
**Verschmelzung von #4 (Schichtenbalken) + #1 (Schichten-Stapel).** Aufwand:
**mittel** (viel bestehender Code wiederverwendbar; ersetzt das gescheiterte
`buildSequenceDiagram`, `buildRound` bleibt als Drilldown „Details je Runde“).

**Warum es P1 trifft, wo Liste & Sequenzdiagramm scheiterten:** Beide Vorgänger
zeigten *Ereignisse* (Pfeil = Moment). Der Kern-Aha (Punkt 4: alles wächst, alles
wird erneut geschickt) ist aber eine *Mengen-Aussage* — sichtbar nur, wenn
**derselbe Sockel optisch wiederkehrt und messbar höher wird**. Jede Runde ist ein
Block, dessen Schichten den komplett gesendeten Verlauf zeigen: untere Schichten
**grau** (war schon da, wird erneut gesendet), genau **eine neue Schicht farbig+➕**
unten. Rechts daneben die Modell-Antwort als **schmaler Zettel** — winzig im
Vergleich zum dicken „rein“-Block: das verkörpert räumlich, dass *rein der ganze
Verlauf geht, raus nur JSON/Text kommt* (Punkt 2/3). Zwischen den Runden ein
**„Anwendung führt aus“-Streifen** (kein Modell-Element) für Punkt 3.

```
RAW-LLM-Protokoll · Anfrage 1                      [ Ablauf erklaeren ✨ ]
"Lies die package.json und fasse die Abhaengigkeiten zusammen"

  2 Runden · 1 Tool · Kontext waechst:  620 ─▶ 870 Token  (+250 / +40%)
  [ ▢ nur Neues zeigen ]   [ ▢ Spalten ↔ Stapel ]   Schichten:
  ▦System  ▨Nutzer  ▧Modell-JSON  ▩Tool-Erg.  ██neu in dieser Runde

┌─ RUNDE 1 ──────────────────────────────────────────── in 620 ──┐
│ Gesendet wird der GANZE Verlauf (2 Nachrichten):               │
│ ┌──────────────────────────────────┐                          │
│ │▦▦▦ System   "Du bist ein Assist…" │ 380 tok            ▕ Modell │
│ │██▨ Nutzer   "Lies die package.j…"●│ 240 tok  ← NEU     ▕ schiebt │
│ └──────────────────────────────────┘                   ▕ zurueck:│
│   ▕███████████████████▏ 620 rein                       ▕         │
│                                              out 28 ▕▏ ░JSON,    │
│                                                        ▕ KEIN Text:│
│                                                        ▕ read_file│
│                                                        ▕ _text{   │
│                                                        ▕  path:   │
│                                                        ▕ "package │
│                                                        ▕ .json"}  │
└────────────────────────────────────────────────────────────────┘
   ▒▒▒ Die ANWENDUNG (nicht das Modell) fuehrt den Wunsch aus: ▒▒▒
   ▒  read_file_text("package.json") → {"dependencies":{…}}  ▒  [▾]
            │  heftet 2 Blaetter ein · Kontext +250 Token
            ▼
┌─ RUNDE 2 ──────────────────────────────────────────── in 870 ──┐
│ Gesendet wird WIEDER alles — jetzt 4 Nachrichten (3 erneut):   │
│ ┌──────────────────────────────────┐                          │
│ │▦▦▦ System    (war schon da)       │ 380   ┐                  │
│ │▨▨▨ Nutzer    (war schon da)       │ 240   │ grau = erneut    │
│ │▧▧  Modell-JSON read_file_text     │  30   │ gefaxt (Sockel)  │
│ │██▩ Tool-Erg. {"react":"^18"…}    ●│ 220   ┘ ← NEU, von App   │
│ └──────────────────────────────────┘                   ▕ Modell │
│   ▕████████████████████████████▏ 870 rein  ↑1,4×       ▕ schiebt │
│                                              out 68 ▕▏  ▕ zurueck:│
│                                                        ▕ █Text:   │
│                                                        ▕ "4 Abhae-│
│                                                        ▕ ngigkeit-│
│                                                        ▕ en: …" ✔ │
└────────────────────────────────────────────────────────────────┘
  ▔ grauer Sockel kehrt JEDES Mal wieder = API ist zustandslos ▔

  ▾ Details je Runde (Volltext, Rohdaten, Stream)   ·   2 Aufrufe
```

**Schlüssel-Interaktionen:**
- **Toggle „nur Neues zeigen“** — blendet die grauen Sockel aus; Zurückschalten
  macht das Wachstum schlagartig sichtbar (der zentrale Zustandslosigkeits-Aha;
  nutzt vorhandene `prevSentCount`-Logik).
- **Klick auf eine Schicht** → klappt die Nachricht(en) im Volltext auf (Drilldown,
  `buildMessageBlock`/`prettyMaybeJson`).
- **Hover über eine graue Schicht** → hebt dieselbe Schicht in der Vorrunde mit
  hervor („dieselbe Nachricht, erneut geschickt“).
- **Klick auf den „Anwendung führt aus“-Streifen** → Tool-Name, Argumente und rohes
  Ergebnis nebeneinander (P3-Audit via `findToolResult`).
- **Hover über den Token-Balken** → Tooltip prompt/completion + Faktor vs. Vorrunde.

---

### 5b. Visuelles Design (Spec) — reproduzierbar ohne das Mockup-Widget

**Pro Anfrage (Turn):** Kopfzeile (Anfrage-Index + `userText` + Button „Ablauf
erklären“), darunter eine Meta-/Steuerzeile, dann die Runden-Blöcke vertikal
gestapelt, dann ein Fuß.

**Steuer-/Meta-Zeile (einmal pro Turn):**
- Kennzahl „N Runden · M Tools · Kontext A → B Token (+x %)“.
- Schalter **„nur Neues zeigen“** (Checkbox) — versteckt alle grauen „alt“-Schichten.
- **Legende** der Schicht-Farben (siehe unten).

**Runden-Block** (volle Breite, Karte: `--bg-primary`, 0.5px Border, Radius lg):
- Block-Kopf: „Runde k“ + rechts „gesendet: N Nachrichten“ (Folge-Runden: „— davon
  X erneut“).
- Zwei Spalten, `display:flex; gap:14px`:
  - **Links (flex 1.7) „ANWENDUNG → MODELL · kompletter Verlauf“** — der Schicht-
    Stapel:
    - Eine Schicht je gesendeter Nachricht, **alle gleich hoch** (~30px), Icon +
      Rollenname + gekürztes Snippet, **linker 3px-Farbrand** je Rolle.
    - **Rollenfarben (bestehende Tokens aus `styles.css` 1:1 übernehmen):** System =
      grau (`--ds-grey-divider`/`--text-muted`), Nutzer = blau (`--accent`/`--ds-blue`),
      Modell-JSON = grün (`--ds-green`), Tool-Ergebnis = amber (`--ds-amber`).
    - **Zustände:** *neu in dieser Runde* = volle Rollenfarbe (getönter Hintergrund)
      + Badge „➕ neu“ (Tool-Ergebnis zusätzlich „· von App“). *war schon da* = grau,
      niedriger Kontrast, Snippet-Text „war schon da“ (+ Amnesie-Tooltip, Abschnitt 7).
    - Darunter der **Gesamt-Balken** (Track `--bg-tertiary`, Füllung `--ds-blue`):
      Breite ∝ Token dieser Runde, normiert auf die größte Runde des Turns (= 100 %).
      Label „N Token gehen rein“, ab Runde 2 Faktor „↑ x,x× ggü. Vorrunde“.
  - **Rechts (flex 1, schmal) „MODELL → ANWENDUNG“** — die Antwort-Karte (grüner
    Border/Tönung). Bewusst **deutlich kleiner** als der linke Block (verkörpert
    „rein ≫ raus“). Inhalt: „out N Token“; bei Tool-Wunsch Label **„JSON, KEIN
    Text:“** + Mono-`name({args})`; bei finaler Antwort „Text ✔“ + Antworttext.

**Zwischen zwei Runden — „Anwendung führt aus“-Streifen** (volle Breite, amber
getönt, als `<details>`): Summary „Die **Anwendung** (nicht das Modell) führt aus —
Klick für Ergebnis“; Body: `toolName(args)` → rohes Ergebnis (gekürzt) + „heftet
ein · Kontext +N Token“. Quelle: `findToolResult` (per `tool_call_id`).

**Fuß:** Hinweiszeile „der graue Sockel kehrt jede Runde wieder — die LLM-API ist
zustandslos“ + eingeklapptes **„Details je Runde“** (bestehendes `buildRound`,
inkl. Rohdaten/Stream).

**Stil-Leitplanken:** zwei Schriftgewichte (400/500), Schriftgrößen ≥ 11px,
Sentence case, keine Emojis (Icons aus bestehendem SVG-Vokabular), Farben nur über
CSS-Variablen (Dark-Mode-fest), keine Pro-Schicht-Token-Zahlen (Entscheidung 8.2).

---

### 5d. Umsetzungs-Skizze (für die Bau-Konversation)

Alles im Renderer, `RawLogModal.js` + `styles.css` — kein Main-/IPC-Eingriff.
- **Neu:** `buildContextStack(turn)` — pro Runde ein Block; Schichten aus
  `ex.messages` via vorhandenem `prevSentCount`-Diff (alt vs. ➕ neu); Gesamt-Balken
  aus `usage` (Fallback Zeichenanzahl); schmale Modell-Antwort-Karte aus
  `ex.response`; „Anwendung führt aus“-Streifen via `findToolResult`.
- **Ersetzt:** `buildSequenceDiagram` (+ dessen `buildTurnSteps`/`svgEl`/seq-CSS).
- **Bleibt:** `buildRound` als „Details je Runde“-Drilldown; „Ablauf erklären“-Button.
- Aufwand: **mittel**, weil Diff-, Rollen-Farb- und Token-Helfer schon existieren.

---

### 5e. Akzeptanzkriterien („fertig“, wenn …)

- [ ] Pro Anfrage werden die Runden als vertikaler Stapel gezeigt; das alte
  SVG-Sequenzdiagramm ist entfernt.
- [ ] In Folge-Runden erscheinen die bereits gesendeten Nachrichten als **graue
  „war schon da“-Schichten**, die neue als **farbig + „➕ neu“** — man sieht den
  Sockel wiederkehren.
- [ ] Der **Gesamt-Balken wächst** sichtbar von Runde zu Runde; Faktor „↑ x,x×“ ist
  korrekt.
- [ ] Die **Modell-Antwort-Karte ist klar kleiner** als der gesendete Stapel (rein ≫
  raus) und benennt den Tool-Wunsch ausdrücklich als „JSON, KEIN Text“.
- [ ] Schalter **„nur Neues zeigen“** blendet die grauen Schichten aus/ein.
- [ ] Der **„Anwendung führt aus“-Streifen** liegt zwischen den Runden (kein Modell-
  Element) und zeigt Tool, Argumente und Ergebnis.
- [ ] „Details je Runde“ (bestehendes `buildRound`) bleibt als Drilldown erreichbar.
- [ ] Alles Dark-Mode-fest, Tastatur-/Screenreader-zugänglich, keine Pro-Schicht-
  Token-Zahlen.

### 5f. Edge-Cases & Sonderfälle

- **Ohne `usage`** (lokale Modelle, Fehler): Balken nach Zeichenanzahl, Label „≈“.
- **error / cancelled**: rot getönter Block/Schicht („kam nicht durch“), erkennbar,
  aber nicht dominant.
- **Viele Runden (>3)**: vertikaler Stapel skaliert; ältere Runden ggf. einklappbar.
- **Mehrere Tool-Aufrufe in einer Runde**: mehrere „➕ neu“-Tool-Schichten + mehrere
  Exec-Streifen (je `tool_call_id`).
- **Lange Inhalte** (Systemprompt, Tool-Ergebnis): Snippet + Klick-Expand; hart
  kürzen, damit eine Schicht das Layout nicht sprengt.
- **Reine Text-Anfrage ohne Tools**: nur Runde 1, kein Exec-Streifen, keine Tool-/
  Modell-JSON-Schicht — der Stapel zeigt dann schlicht System + Nutzer → Text.

---

## 6. Alternativen (kein Ersatz, sondern Spezialfälle)

- **#5 „Akte am Fax“** — wenn das Publikum klar **nicht-technisch** ist
  (Stakeholder-Demo, Onboarding). Eingängigste Erklärung der Zustandslosigkeit,
  aber zu verspielt, sobald Entwickler die Hauptnutzer sind.
- **#2 „Geführte Tour“** — als **optionaler, abschaltbarer Erst-Erklär-Modus
  (Stepper)** *über* der Stapel-Ansicht, nicht als Ersatz. Gut beim allerersten
  Kontakt; ungeeignet fürs wiederkehrende Auditieren und ab >3 Runden.

---

## 7. Bausteine zum Übernehmen (aus den anderen Entwürfen)

- **Wörtlich „war schon da“ / „erneut“** an jeder grauen Sockel-Schicht (aus #5) —
  verbalisiert die Zustandslosigkeit zusätzlich zur Farbe.
- **Amnesie-Tooltip** am Sockel: „Das Modell erinnert sich an nichts — darum reist
  jedes Mal alles erneut mit.“ (aus #5)
- **Faktor-Indikator** „↑1,4× ggü. Vorrunde“ am Request (aus #3).
- **Tool-Ledger am Fuß**: `read_file_text({path}) ✓ 200 tok` als kompakte
  P3-Audit-Zusammenfassung, klickbar zur Tool-Schicht (aus #4).
- **Optional: kumulierte Token-Kurve** über alle Runden (aus #4) für lange
  Sessions, wo Einzelbalken klein werden.
- **Pro Schicht-Typ ein knapper Lehrsatz-Tooltip** (z. B. „JSON-Tool-Wunsch — die
  Datei ist NICHT gelesen“) (aus #2) — Didaktik ohne Klick-Overhead.

---

## 8. Offene Entscheidungen (Iterations-Agenda)

1. ✅ **ENTSCHIEDEN:** Leitkonzept = **vertikaler Kontext-Schichtstapel** (diese
   Richtung weiter verfeinern).
2. ✅ **ENTSCHIEDEN:** **Nur der Gesamt-Balken je Runde skaliert echt nach Token;
   Schichten werden gleich hoch dargestellt** (keine Scheingenauigkeit). Die
   Pro-Schicht-Token-Zahlen im Mockup oben sind damit hinfällig.
3. ✅ **ENTSCHIEDEN (Default, in Bau-Konversation revidierbar):** Fallback ohne
   `usage` (lokale Modelle, Fehlerrunden) → Balken nach **Zeichenanzahl** der
   gesendeten Nachrichten skalieren, Label „≈“ statt exakter Token.
4. ✅ **ENTSCHIEDEN:** Default = **vertikaler Stapel**.
5. ✅ **ENTSCHIEDEN:** Stapel-Ansicht **ersetzt** das Sequenzdiagramm; „Details je
   Runde“ bleibt als Drilldown.
6. ✅ **ENTSCHIEDEN (Default):** Die **„Ablauf erklären“-LLM-Funktion bleibt** als
   separater Prosa-Button erhalten (ergänzt den deterministischen Stapel, ersetzt
   ihn nicht).
7. ✅ **ENTSCHIEDEN (Default):** Sonderzustände error/cancelled → eigener **rot
   getönter** Block/Schicht-Stil („kam nicht durch“), klar erkennbar, aber nicht
   lauter als der didaktische Normalfall.

→ Keine offenen Punkte mehr. Konzept vollständig.

---

## 9. Verlauf der Iteration

- **v0:** Liste, dann Sequenzdiagramm gebaut; Kern (P1) verfehlt → Schritt zurück.
- **v1:** Konzept-Doku angelegt; Ziele priorisiert (P1 didaktisch).
- **v2:** 5 divergente Konzepte erarbeitet + bewertet (Multi-Agent-Exploration).
  Empfehlung: **vertikaler Kontext-Schichtstapel** (#4 ⊕ #1).
- **v3:** Richtung bestätigt; Wachstums-Maß entschieden (Gesamt-Balken echt,
  Schichten gleich hoch). Verfeinertes interaktives Mockup gebaut.
- **v4:** Mockup abgenommen; Stapel ersetzt das Sequenzdiagramm.
- **v5: Konzept FREIGEGEBEN & übergabereif ✅.** Alle Entscheidungen final (Defaults
  für 3/6/7 gesetzt), Design-Spec + Akzeptanzkriterien + Edge-Cases ergänzt.
  Umsetzung folgt in **eigener Konversation** — dieses Dokument ist die Vorgabe.
