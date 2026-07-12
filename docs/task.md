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

## 🧰 Token-effizientes Datei-Toolset (Vorschlag vom 2026-07-12)

Die folgenden neun Einträge gehören zusammen: Sie erweitern das bestehende
Workspace-Tool-Set (`list_directory`, `read_file_text`, `write_file_text`,
`debug_wait` in `src/main/tools/workspace-tool-registry.js`, Handler in
`src/main/services/fs-service.js`) um Tools, die das LLM **gezielt** auf lokale
Dateien zugreifen lassen — mit dem Ziel, **möglichst wenig Token** zu
verbrauchen. Alle neuen Tools sollen dem bestehenden Muster folgen:
Handler im `fs-service`, Registrierung in `workspace-tool-registry`, Sandbox
über `resolveWorkspacePathForAccess` (kein Zugriff außerhalb des
Projektordners), Read-only vs. `requiresWrite`, plus Tests in
`test/fs-service.test.js` und `test/workspace-tool-registry.test.js`.

Priorisierung (siehe einzelne Einträge): **Tier 1** = T1–T3 (größter
Token-Hebel, empfohlener Kern), **Tier 2** = T4–T6, **Tier 3** = T7–T9
(nice-to-have / später).

Die Tools greifen bewusst ineinander — die klassische Schleife ist
**suchen (T1) → gezielt lesen (T2) → gezielt editieren (T3)**, ergänzt um
finden (T4), prüfen (T5) und Struktur extrahieren (T6). Die Querbezüge sind in
den einzelnen Einträgen jeweils vermerkt.

### 💡 T1 · `search_in_files` – Grep/Ripgrep-artige Volltextsuche im Workspace

**Label:** `enhancement`

**Priorität:** Tier 1 (größter Token-Hebel), empfohlener Kern zusammen mit
[T2](#-t2--read_file_lines--teil-lesen-von-dateien-zeilen--oder-byte-range)
und [T3](#-t3--edit_file--gezielter-string-patch-ersatz-ohne-vollausgabe).

**Problem / Kontext**

Es gibt aktuell kein Such-Tool. Um „wo steht X?" zu beantworten, muss das
Modell `list_directory` + `read_file_text` über viele Dateien laufen lassen —
jede Datei landet komplett im Kontext. Das ist der größte Token-Fresser des
bestehenden Tool-Sets.

**Vorschlag / Umsetzung**

- Neues Read-only-Tool `search_in_files`, das einen Regex/String **rekursiv**
  im Workspace sucht und **nur Trefferzeilen mit N Kontextzeilen** (plus
  `Datei:Zeile`) zurückgibt — statt ganzer Dateien.
- Parameter (Vorschlag): `query` (String/Regex), `is_regex` (bool),
  `relative_path` (Startordner, Default Root), `context_lines` (Default z. B. 2),
  `max_results`/`max_matches` (Kappung), optional `case_sensitive`,
  `include`/`exclude`-Glob.
- Standardmäßig `.gitignore` und binäre/zu große Dateien überspringen, versteckte
  Einträge wie bei `list_directory` ausklammern (bzw. per Flag zuschaltbar).
- **Umsetzungsentscheidung offen:** `ripgrep` (extrem schnell, respektiert
  `.gitignore`, aber Binär-Dependency in der Electron-App) **oder** reine
  JS-Implementierung (rekursiver Walk + Regex, Zeilen-gepuffert). Empfehlung:
  JS-Variante zuerst, `ripgrep` optional später.

**Querbezüge**

- Liefert `Datei:Zeile`-Treffer, die typischerweise direkt in
  [T2 (`read_file_lines`)](#-t2--read_file_lines--teil-lesen-von-dateien-zeilen--oder-byte-range)
  fließen (gezielt nur den relevanten Block nachlesen).
- Zum reinen **Finden von Pfaden** (nicht Inhalten) ist
  [T4 (`find_files`)](#-t4--find_files--globrekursives-finden-von-pfaden) das
  passendere Tool.

**Nutzen**

Ersetzt „viele Dateien komplett lesen" durch wenige KB Treffer — größte
Token-Ersparnis im gesamten Toolset.

### 💡 T2 · `read_file_lines` – Teil-Lesen von Dateien (Zeilen- oder Byte-Range)

**Label:** `enhancement`

**Priorität:** Tier 1, empfohlener Kern zusammen mit
[T1](#-t1--search_in_files--grepripgrep-artige-volltextsuche-im-workspace) und
[T3](#-t3--edit_file--gezielter-string-patch-ersatz-ohne-vollausgabe).

**Problem / Kontext**

`read_file_text` liest immer ab dem Dateianfang und schneidet nur hart per
`max_characters` ab. Wird nur ein Ausschnitt gebraucht (z. B. Zeilen 400–450),
wird trotzdem alles davor mitgelesen und verbraucht Token.

**Vorschlag / Umsetzung**

- Read-only-Tool `read_file_lines` (oder Erweiterung von `runReadFileTextTool`
  um Range-Parameter), das nur einen Ausschnitt zurückgibt.
- Parameter (Vorschlag): `relative_path`, `start_line`/`end_line` (1-basiert,
  inklusiv) **oder** `start_byte`/`length`; Rückgabe mit **Zeilennummern**, damit
  Treffer aus T1 exakt adressierbar bleiben.
- Bestehende Sandbox-/Größenlimits von `runReadFileTextTool` wiederverwenden.

**Querbezüge**

- Direkter Anschluss an
  [T1 (`search_in_files`)](#-t1--search_in_files--grepripgrep-artige-volltextsuche-im-workspace):
  Treffer `Datei:Zeile` → gezielt Block nachlesen.
- Gut kombinierbar mit
  [T6 (`outline_file`)](#-t6--outline_file--strukturgliederung-eines-dokuments-extrahieren):
  erst Gliederung holen, dann den gewünschten Abschnitt per Zeilenbereich lesen.
- Die zurückgegebenen Zeilennummern erleichtern anschließend präzise Edits über
  [T3 (`edit_file`)](#-t3--edit_file--gezielter-string-patch-ersatz-ohne-vollausgabe).

**Nutzen**

Gezieltes Nachlesen statt Volltext — spart Input-Token nach einer Suche.

### 💡 T3 · `edit_file` – gezielter String-/Patch-Ersatz ohne Vollausgabe

**Label:** `enhancement`

**Priorität:** Tier 1, empfohlener Kern zusammen mit
[T1](#-t1--search_in_files--grepripgrep-artige-volltextsuche-im-workspace) und
[T2](#-t2--read_file_lines--teil-lesen-von-dateien-zeilen--oder-byte-range).

**Problem / Kontext**

`write_file_text` überschreibt eine Datei komplett. Für eine kleine Änderung an
einer großen Datei muss das Modell die **gesamte** Datei als Output erzeugen —
und Output-Token sind am teuersten.

**Vorschlag / Umsetzung**

- Schreib-Tool `edit_file` (`requiresWrite: true`), das eine Datei durch
  `old_string → new_string` (oder das Ersetzen eines Zeilenbereichs) ändert,
  ohne dass das Modell die ganze Datei ausgibt. Analog zu gängigen
  LLM-Edit-Tools.
- **Eindeutiges Matching erzwingen:** Fehler bei mehrdeutigem (mehrfachem) oder
  keinem Treffer; optional `replace_all`-Flag; klare Fehlermeldungen.
- Sandbox-, Größen- und Ordner-Schutz aus `runWriteFileTextTool`
  wiederverwenden; wie dort nur bei aktivem `allowWorkspaceWrite` verfügbar.

**Querbezüge**

- Nutzt Ergebnisse von
  [T1](#-t1--search_in_files--grepripgrep-artige-volltextsuche-im-workspace)/[T2](#-t2--read_file_lines--teil-lesen-von-dateien-zeilen--oder-byte-range),
  um `old_string`/Zeilenbereich präzise zu bestimmen.
- Für mehrere/komplexe Änderungen in einem Schritt siehe
  [T8 (`apply_patch`)](#-t8--apply_patch--unified-diffmehrere-edits-atomar-später);
  T3 ist der einfachere, robustere Einstieg, T8 die Erweiterung „wenn T3 zu
  limitierend wird".

**Nutzen**

Spart die teuersten **Output**-Token bei Änderungen erheblich.

### 💡 T4 · `find_files` – Glob/rekursives Finden von Pfaden

**Label:** `enhancement`

**Priorität:** Tier 2.

**Problem / Kontext**

`list_directory` ist nicht rekursiv und blendet versteckte Einträge aus. Um
einen Pfad zu finden, braucht das Modell viele Tool-Runden Ebene für Ebene.

**Vorschlag / Umsetzung**

- Read-only-Tool `find_files`, das Pfade per **Glob** findet (z. B.
  `**/*.js`), mit Limit und optionalem Einschluss versteckter Dateien.
- Parameter (Vorschlag): `pattern` (Glob), `relative_path` (Startordner),
  `max_results`, `include_hidden` (Default false).
- Für das Glob-Matching bietet sich `picomatch` an (steht bereits in den
  `overrides` von `package.json`); `.gitignore` respektieren wie bei
  [T1](#-t1--search_in_files--grepripgrep-artige-volltextsuche-im-workspace).

**Querbezüge**

- Komplementär zu
  [T1 (`search_in_files`)](#-t1--search_in_files--grepripgrep-artige-volltextsuche-im-workspace):
  T4 findet **Pfade** (nach Namen/Muster), T1 findet **Inhalte**.
- Teilweise überlappend mit
  [T7 (`list_directory_tree`)](#-t7--list_directory_tree--rekursiver-baum-mit-tiefelimit-später);
  ein rekursiver Walk-Helper könnte für T1/T4/T7 gemeinsam genutzt werden.

**Nutzen**

Ersetzt viele `list_directory`-Runden durch einen Aufruf.

### 💡 T5 · `stat_path` / `get_file_info` – Metadaten ohne Datei­inhalt

**Label:** `enhancement`

**Priorität:** Tier 2.

**Problem / Kontext**

Um Existenz, Typ, Größe oder Zeilenzahl einer Datei zu prüfen, muss das Modell
sie derzeit lesen — obwohl der Inhalt gar nicht gebraucht wird.

**Vorschlag / Umsetzung**

- Read-only-Tool `stat_path` (bzw. `get_file_info`), das nur **Metadaten**
  liefert: Existenz, Typ (Datei/Ordner), Größe in Bytes, `mtime`, optional
  Zeilenzahl.
- Parameter (Vorschlag): `relative_path`. Sandbox über
  `resolveWorkspacePathForAccess`.

**Querbezüge**

- Hilft dem Modell zu entscheiden, **ob/wie** es liest — z. B. bei großen
  Dateien lieber
  [T2 (`read_file_lines`)](#-t2--read_file_lines--teil-lesen-von-dateien-zeilen--oder-byte-range)
  statt `read_file_text`, oder erst
  [T6 (`outline_file`)](#-t6--outline_file--strukturgliederung-eines-dokuments-extrahieren).

**Nutzen**

Verhindert „lesen nur um zu prüfen" — kleine, aber häufige Ersparnis.

### 💡 T6 · `outline_file` – Struktur/Gliederung eines Dokuments extrahieren

**Label:** `enhancement`

**Priorität:** Tier 2.

**Problem / Kontext**

Für viele Fragen reicht die **Landkarte** eines Dokuments statt des Volltexts.
Aktuell muss dafür die ganze Datei (u. U. Hunderte KB) gelesen werden — genau
das Beispiel aus der ursprünglichen Anfrage („Kontext extrahieren statt alles
lesen").

**Vorschlag / Umsetzung**

- Read-only-Tool `outline_file`, das nur das Gerüst zurückgibt: Markdown-
  Überschriften, Funktions-/Klassensignaturen o. Ä. — quasi ein
  Inhaltsverzeichnis mit Zeilennummern.
- **MVP:** Markdown-Headings + generische Signatur-Regex; später sprachabhängige
  Heuristiken.
- Rückgabe mit Zeilennummern, damit gezieltes Nachlesen direkt anschließen kann.

**Querbezüge**

- Bildet mit
  [T2 (`read_file_lines`)](#-t2--read_file_lines--teil-lesen-von-dateien-zeilen--oder-byte-range)
  das Muster „erst Gliederung, dann gezielt den Abschnitt lesen".
- Ergänzt
  [T5 (`stat_path`)](#-t5--stat_path--get_file_info--metadaten-ohne-dateiinhalt):
  Metadaten sagen *wie groß*, das Outline sagt *was drinsteht*.

**Nutzen**

Erfüllt direkt den Use Case „Kontext aus einem Dokument extrahieren, ohne die
ganze Datei zu lesen".

### 💡 T7 · `list_directory_tree` – rekursiver Baum mit Tiefe/Limit (später)

**Label:** `enhancement`

**Priorität:** Tier 3 (nice-to-have).

**Problem / Kontext**

Ein kompakter, rekursiver Überblick über eine Ordnerstruktur ist aktuell nur
über viele `list_directory`-Aufrufe möglich.

**Vorschlag / Umsetzung**

- Read-only-Tool `list_directory_tree`, das einen rekursiven Baum mit
  konfigurierbarer `max_depth` und Gesamt-Limit in **einem** Aufruf liefert.
- Parameter (Vorschlag): `relative_path`, `max_depth`, `max_entries`,
  `include_hidden`.

**Querbezüge**

- Überschneidet sich teilweise mit
  [T4 (`find_files`)](#-t4--find_files--globrekursives-finden-von-pfaden); vor
  der Umsetzung prüfen, ob T4 den Bedarf bereits deckt. Ein gemeinsamer
  rekursiver Walk-Helper (auch für
  [T1](#-t1--search_in_files--grepripgrep-artige-volltextsuche-im-workspace))
  wäre sinnvoll.

**Nutzen**

Kompakter Struktur-Überblick in einem Aufruf; nur umsetzen, falls T4 nicht
ausreicht.

### 💡 T8 · `apply_patch` – unified-diff/mehrere Edits atomar (später)

**Label:** `enhancement`

**Priorität:** Tier 3 (später, mächtiger aber komplexer).

**Problem / Kontext**

Für mehrere zusammenhängende Änderungen in einer Datei ist wiederholtes
Einzel-Editieren umständlich. Ein Patch-Format (mehrere Hunks / unified diff)
wäre effizienter — aber deutlich fehleranfälliger.

**Vorschlag / Umsetzung**

- Schreib-Tool `apply_patch` (`requiresWrite: true`), das mehrere Edits atomar
  bzw. einen unified-diff anwendet (entweder alles oder nichts).
- Robuste Fehlerbehandlung bei nicht anwendbaren Hunks; Sandbox-/Größenlimits
  wie bei den anderen Schreib-Tools.

**Querbezüge**

- Erweiterung von
  [T3 (`edit_file`)](#-t3--edit_file--gezielter-string-patch-ersatz-ohne-vollausgabe):
  **erst T3 umsetzen**, T8 nur wenn T3 für Mehrfach-Änderungen zu limitierend
  wird.

**Nutzen**

Effizienter bei komplexen Mehrfach-Änderungen; wegen höherer Komplexität
bewusst nachrangig.

### 💡 T9 · `extract_document_text` – PDF/DOCX/XLSX → Text (später)

**Label:** `enhancement`

**Priorität:** Tier 3 (eigenes Roadmap-Thema, schwere Dependencies).

**Problem / Kontext**

Die README-Vision (Büro-/HR-Profile) legt nahe, dass auch Office-/PDF-Dokumente
verarbeitet werden sollen. Diese sind derzeit für das Text-Lese-Tool
unzugänglich.

**Vorschlag / Umsetzung**

- Read-only-Tool `extract_document_text`, das aus PDF/DOCX/XLSX reinen Text (ggf.
  seiten-/abschnittsweise) extrahiert.
- Bringt schwere Dependencies mit sich; sprengt den engeren Rahmen „lokale
  Datei-Durchforstung". Vor der Umsetzung als eigenes Roadmap-Thema einordnen
  (siehe [`roadmap.md`](./roadmap.md), Abschnitt „Später / Ideen"), statt es an
  T1–T6 anzuhängen.

**Querbezüge**

- Sollte, sobald umgesetzt, auszugsweise mit
  [T2 (`read_file_lines`)](#-t2--read_file_lines--teil-lesen-von-dateien-zeilen--oder-byte-range)-
  bzw.
  [T6 (`outline_file`)](#-t6--outline_file--strukturgliederung-eines-dokuments-extrahieren)-artiger
  Logik kombinierbar sein (abschnittsweise statt Volltext), um dem Token-Ziel
  treu zu bleiben.

**Nutzen**

Öffnet Office-/PDF-Inhalte für das Modell; wegen Umfang und Dependencies klar
nachrangig und eher Roadmap- als Kern-Tool.
