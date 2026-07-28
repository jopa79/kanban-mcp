# ADR 0001 — Spalten wandern aus der Datenbank in `config.json`

Datum: 2026-07-28
Status: Angenommen (Grilling-Session mit JoPa)
Betrifft: Schema v3, `kanban-mcp` 0.2.0

## Kontext

Bis Schema v2 lebt die Board-Struktur in einer SQLite-Tabelle `columns`
(`id`, `name`, `position`, `wip_limit`, `is_terminal`). `BoardService` liest sie
bei jedem Zugriff per SQL, `initBoard` fuellt sie ueber `seedColumns()` mit fuenf
Default-Zeilen.

Daraus ergeben sich drei Reibungspunkte:

1. **Die Spalten sind Konfiguration, keine Daten.** Sie werden praktisch nie
   geaendert, aber bei jeder Task-Operation gelesen. Sie in derselben Datei zu
   halten wie die Tasks vermischt "wie das Board aussieht" mit "was auf dem
   Board liegt".
2. **Sie sind nicht von Hand aenderbar.** Ein WIP-Limit anzupassen erfordert
   heute entweder ein neues CLI-Kommando oder `sqlite3`. Fuer eine Einstellung,
   die man ein- bis zweimal pro Projekt setzt, ist beides zu viel.
3. **Sie sind nicht diffbar.** `.kanban/board.db` ist eine Binaerdatei und in
   der Regel nicht versioniert. Wer die Board-Struktur eines Projekts im Git
   sehen oder reviewen will, kann es nicht.

Mit 0.2.0 kommen zusaetzlich Eintrittsregeln pro Spalte (`allowEntry`) und die
Zustandsmaschine leitet ihre Kettenlogik aus `position` ab. Beides sind
Regeln, keine Datensaetze.

## Entscheidung

Die Tabelle `columns` entfaellt ersatzlos. Die Spaltendefinition zieht nach
`.kanban/config.json`, wo bereits Board-Name und Erstellungsdatum liegen.

`BoardService` wird config-gestuetzt: `getColumns`, `getColumn` und
`getTerminalColumn` lesen aus der geladenen `BoardConfig`. Einzig
`getColumnTaskCount` bleibt SQL — es zaehlt Tasks, nicht Spalten.

**Die Reihenfolge der Spalten ist die Reihenfolge im Array**, nicht ein
`position`-Feld. Beim Einlesen wird der Index zur Position. Das ist die einzige
Stelle, an der die neue Darstellung mehr kann als die alte: eine Tabelle mit
`position`-Spalte laesst zwei Zeilen mit `position: 2` zu, eine Array-Reihenfolge
nicht. Und eine Spalte zu verschieben heisst, eine Zeile zu verschieben — im
git-Diff sofort lesbar, was der eigentliche Zweck des Umzugs ist.

Die Fremdschluesselbeziehung `tasks.column_id REFERENCES columns(id)` faellt
damit weg. Ein Task kann fortan auf eine Spalte zeigen, die in der Config
fehlt. Solche Tasks werden **nicht** repariert, versteckt oder verschoben,
sondern in der TUI in einer virtuellen Sammelspalte sichtbar gemacht.

## Begruendung

- Konfiguration gehoert in eine Textdatei, die man lesen, editieren, versionieren
  und reviewen kann.
- Der Verlust des Fremdschluessels ist der Preis, und er ist niedriger als er
  aussieht: der Constraint hat bisher genau einen Fehler verhindert (Task in
  nicht existierender Spalte), und dieser Zustand ist unter dem neuen Modell
  ein darstellbarer, sichtbarer Zustand statt eines Schreibfehlers.
- Ein Datenbank-Roundtrip pro Spaltenabfrage entfaellt. Nebeneffekt, kein Motiv.

## Verworfene Alternativen

**Spalten bleiben in der DB, zusaetzlich ein CLI-Kommando `kanban column`.**
Loest die Aenderbarkeit, nicht die Lesbarkeit und nicht die Versionierbarkeit.
Und es fuegt Oberflaeche fuer eine Operation hinzu, die pro Projekt einmal
vorkommt.

**Spalten in der DB, gespiegelt nach config.json.**
Zwei Quellen der Wahrheit. Die Frage "welche gewinnt bei Abweichung?" hat keine
gute Antwort und muesste bei jedem `openDb()` beantwortet werden.

**Eigene Datei `.kanban/columns.json` statt Erweiterung der `config.json`.**
Trennt zwei Dinge, die zusammengehoeren: beide beschreiben, wie dieses Board
aussieht. Eine Datei weniger zu oeffnen ist eine Datei weniger, die fehlen kann.

**Fremdschluessel behalten und `columns` als View auf die Config.**
SQLite kennt keine Views auf externe JSON-Dateien ohne Erweiterung. Nicht
umsetzbar.

## Konsequenzen

- Schema-Version 3, Migration ueber das neue Kommando `kanban migrate`.
  Der Tabellen-Neubau von `tasks` (zum Entfernen des Constraints) ist der
  riskanteste Teil der Migration — siehe Plan, Abschnitt 2.3.
- Export-Format v3: `columns` bleiben im `board.json` des ZIP-Archivs, weil ein
  Export ein vollstaendiger Snapshot sein soll. Beim Import werden sie nach
  `config.json` geschrieben.
- Ein von Hand kaputt editiertes `config.json` kann das Board unbrauchbar
  machen. `kanban migrate` verifiziert die geschriebene Config deshalb durch
  Zuruecklesen, und die Ladepfade muessen fehlende oder unlesbare Configs mit
  einer verstaendlichen Meldung quittieren statt mit einem Stacktrace.
- Verwaiste Tasks sind ein neuer, dauerhaft moeglicher Zustand und brauchen
  eine Darstellung in TUI und `kanban status`.
