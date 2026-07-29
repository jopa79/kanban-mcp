# Changelog

Alle wesentlichen Aenderungen an diesem Projekt werden hier dokumentiert.

Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.0.0/),
Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Added

- Schema v3: Spalten-Konfiguration in `.kanban/config.json` statt in einer
  DB-Tabelle — lesbar, editierbar und versionierbar (ADR 0001, `docs/decisions/0001-spalten-in-config-statt-datenbank.md`)
  - Jede Spalte bekommt `allowEntry` (darf `kanban_add_task` dort neue Tasks
    anlegen?) statt einer separaten Eintrittsspalten-Liste im Code
  - Kein `position`-Feld mehr — die Array-Reihenfolge in `config.json` ist die
    Reihenfolge; eine Spalte verschieben heisst eine Zeile verschieben
  - `validateBoardConfig()` / `loadBoardConfig()` validieren config.json beim
    Laden mit verstaendlichen Fehlermeldungen (Pfad + Grund, kein Stacktrace):
    fehlende/leere Spaltenliste, keine oder mehrere Terminal-Spalten, keine
    Eintrittsspalte, doppelte Spalten-IDs, faelschlich vorhandenes `position`-Feld
  - `BoardService.getOrphanColumnIds()` — findet Tasks, deren Spalte in
    `config.json` fehlt (Grundlage fuer die Waisen-Behandlung in einem
    Folge-Task; wird aktuell nur ermittelt, noch nicht in TUI/CLI angezeigt)
- Schema v3: `transitions`-Tabelle (Zustandshistorie eines Tasks, wird ab
  Paket 1 befuellt) sowie `priority`/`due_date`-Spalten auf `tasks` (echte,
  sortierbare Felder; Durchreichen an CLI/MCP/TUI folgt in Paket 2)
  - `Transition`/`TransitionRow`-Typen und `rowToTransition()` in `types.ts`,
    analog zu `Task`/`TaskRow`/`rowToTask`
  - Bewusst **kein** `source_id` und kein `updated_by` auf `tasks` — siehe
    Plan Abschnitt 0.1 (TodoWrite liefert kein `id`-Feld) und Entscheidung K-3
  - `tasks`-Spalten-DDL und Index-/Transitions-Erzeugung sind jetzt geteilte
    Bausteine (`TASKS_TABLE_COLUMNS_DDL`, `createTaskIndexes()`,
    `createTransitionsTable()` in `db.ts`) — verhindert Schema-Drift zwischen
    neu angelegten und migrierten Boards
- `kanban migrate [--dry-run] [--yes]` — explizites Kommando fuer die
  Schema-Migration v2 auf v3 (ADR 0001, `src/core/migrate-v3.ts`)
  - Backup vor jeder Migration per `VACUUM INTO` nach `board.db.bak-v2`
    (WAL-sicher — eine reine Datei-Kopie waere bei offenen Transaktionen
    unvollstaendig); ein bestehendes Backup wird nie ueberschrieben, sondern
    als `board.db.bak-v2.<timestamp>` ergaenzt
  - Spalten werden aus der `columns`-Tabelle nach `config.json` uebersetzt:
    nach `position` sortiert, Array-Reihenfolge ersetzt das Feld (auch bei
    lueckenhaften Werten); die ersten beiden Spalten werden Eintrittsspalten
  - `config.json` wird atomar geschrieben (tmp-Datei + fsync + rename) und vor
    dem DB-Umbau zurueckgelesen und verifiziert — bei Abweichung bricht die
    Migration ab, ohne die DB anzufassen
  - `tasks` wird ohne `columns`-Fremdschluessel neu aufgebaut
    (`PRAGMA foreign_keys = OFF` waehrend des Tabellen-Neubaus, sonst
    kaskadiert `DROP TABLE tasks` die komplette `dependencies`-Tabelle weg);
    Nachpruefung per Zeilenzahl-Vergleich und `PRAGMA foreign_key_check`
  - Wiederaufsetzbar: bricht ein Lauf nach dem Schreiben von `config.json` ab,
    erkennt der naechste Lauf das und ueberspringt den Schreibschritt
  - Verifiziert gegen eine Kopie des echten Projekt-Boards (44 Tasks,
    49 Dependencies, 1 archivierter Task) — alle Zahlen nach der Migration
    identisch, `PRAGMA foreign_key_check` liefert nichts
- Board-Registry (`~/.config/kanban/registry.json`, respektiert
  `XDG_CONFIG_HOME`; pfadbasierter Kern von P3-1) — Grundlage fuer das
  kommende `kanban boards`-Kommando
  - `src/core/registry-service.ts`: registrieren (idempotent), entfernen,
    lesen; tote Pfade werden als `missing` markiert statt entfernt
  - Registry-Verzeichnis ist injizierbar (Konstruktor-Parameter), niemals im
    Service hartkodiert
  - Bewusst **nicht** unter `~/.kanban/` — das heisst im Code bereits
    eindeutig "hier liegt ein Board" (siehe `getBoardPaths()` in `db.ts`)
  - Atomares Schreiben (tmp-Datei + rename) gegen gleichzeitige Prozesse
  - `kanban init` registriert automatisch, `--no-register` schaltet das ab
  - **Bewusst getrennt**: `initBoard()` selbst registriert nie — sonst waere
    die Registry nach jedem Testlauf (`tests/helpers.ts`) voller temporaerer
    Pfade
  - Noch offen (folgt nach P0-1/`BoardConfig`): `kanban boards`-Kommando,
    Schema-v2-Erkennung, Task-Zahlen pro Board
- MCP: Task-Abhaengigkeiten vollstaendig ueber MCP nutzbar (vorher nur bei Erstellung setzbar)
  - `kanban_add_dependency` — Task nachtraeglich von einem anderen abhaengig machen
  - `kanban_remove_dependency` — bestehende Abhaengigkeit aufheben (loest gekuerzte IDs auf)
  - `kanban_get_task` liefert jetzt `isBlocked`, `dependsOn` und `dependents` mit
  - Service-Tests fuer Abhaengigkeiten (get/add/remove/isBlocked/Cascade)
- TUI: `a` = Task direkt archivieren (mit Bestaetigungsdialog)
- TUI: Sticky Header/Footer — Header und StatusBar bleiben bei langen Listen sichtbar
- Board Export/Import als ZIP-Archiv
  - `kanban export [output-path]` — Board als ZIP exportieren (board.json + Notes)
  - `kanban import <zip-path>` — Board aus ZIP importieren (`--force` zum Ueberschreiben)
  - MCP Tools: `kanban_export_board`, `kanban_import_board`
  - Exportiert: Config, Spalten, Tasks (inkl. archivierte), Dependencies, Markdown-Notes
  - Import validiert Schema-Version und Dependencies auf existierende Tasks
  - TUI: `E` = Board exportieren, `I` = Board importieren (mit Ueberschreib-Bestätigung)
  - Export-Format v3 (P0-6): `transitions` sowie `priority`/`dueDate` pro Task
    mit im Export; Spalten als geordnetes Array ohne `position`-Feld (analog
    `config.json`, ADR 0001) zusaetzlich zum vollstaendigen `config`-Objekt —
    ein Export bleibt ein vollstaendiger, eigenstaendig lesbarer Snapshot.
    Bewusst **kein** `sourceId`/`source_id` (siehe Plan Abschnitt 0.1)
  - v2-Import (Pflicht, Rueckwaerts-Kompatibilitaet): ein vor der
    Schema-v3-Migration erzeugtes ZIP landet direkt als v3-Board, `kanban
    migrate` ist danach nicht mehr noetig. Spalten-Uebersetzung identisch zur
    Logik aus `kanban migrate` (P0-4, `deriveColumnConfigs` wiederverwendet):
    nach `position` sortiert, Array-Reihenfolge wird zur Ordnung, die ersten
    beiden Spalten werden Eintrittsspalten; `transitions`/`priority`/`dueDate`
    bleiben leer bzw. NULL. Import meldet, welche Spalten Eintrittsspalten
    wurden
  - `importBoard()` liefert jetzt einen `ImportReport` (Quell-Version,
    optionaler Hinweistext) statt `void` — CLI und MCP geben den Hinweistext
    mit aus; die Praesentation bleibt beim Aufrufer, der Service loggt nicht
    selbst (analog `MigrationReport` in `migrate-v3.ts`)
- Markdown-Notizen pro Task (`.kanban/notes/<id>.md`)
  - `kanban add -n "text"` — Notizen beim Erstellen mitgeben
  - `kanban note <id>` — Notizen im `$EDITOR` oeffnen
  - MCP Tools: `notes` Parameter bei `kanban_add_task`, `kanban_update_task`, `kanban_add_task_checked`
  - MCP `kanban_get_task` liefert Notes-Inhalt mit
  - TUI: Notes-Anzeige in Detail-Ansicht, `e` zum Editieren, `[N]`-Indikator auf Task-Karten
  - `hasNotes` Flag bei `listTasks` (Performance: kein Datei-Inhalt laden)

### Removed

- `plugins/ralph-tracker` — das Tracker-Plugin fuer [Ralph TUI](https://github.com/subsy/ralph-tui)
  ist ersatzlos entfernt, samt seiner deployten Kopie unter
  `~/.config/ralph-tui/plugins/trackers/`
  - Damit entfaellt der einzige externe Konsument von `kanban status --json`
    und `kanban list --json`. Das Ausgabeformat dieser beiden Kommandos ist
    kein Vertrag mehr gegenueber Dritten
  - Die Testsuite ist dadurch wieder vollstaendig gruen: der Test des Plugins
    rief das global installierte `/opt/homebrew/bin/kanban` auf, einen Wrapper
    auf ein **anderes** Repository, und schlug seit Laengerem sporadisch fehl

### Changed

- `BoardService` liest Spalten jetzt aus `config.json` statt per SQL aus der
  `columns`-Tabelle (`getColumns`, `getColumn`, `getTerminalColumn`); die
  `columns`-Tabelle entfaellt, `tasks.column_id` hat keinen Fremdschluessel
  mehr darauf. `getColumnTaskCount` bleibt SQL — zaehlt Tasks, nicht Spalten
- DB-Schema-Version 2 → 3. `openDb()` migriert nicht mehr automatisch beim
  Oeffnen (bisheriges `migrateDb()` entfernt) — `assertSchemaCurrent()` in
  `db.ts` (P0-5, exportiert, ersetzt die P0-1-Notbremse
  `assertSchemaNotStale`) prueft bei jedem Oeffnen die Version und verweigert
  den Start bei Abweichung. Eine zu niedrige Version nennt Pfad und
  Projektordner fuer `kanban migrate`; eine zu hohe Version (aelterer Client
  an einem neueren Board) bekommt eine eigene Meldung ("Aktualisiere
  kanban-mcp") statt des dort falschen Migrations-Rats
  - Greift einheitlich an allen Einstiegspfaden: CLI (`kanban list` etc.) und
    TUI brechen formatiert mit Exit 1 ab, MCP-Tools liefern `isError: true`,
    `kanban export` verweigert sich ohne ZIP zu erzeugen
  - Ausnahme `kanban sync`: Meldung auf **stderr**, **Exit 0** — ein Hook, der
    einen Agenten-Turn mit Exit 1 stoert, richtet mehr Schaden an als ein
    ausgefallener Sync (bestehende Konvention aus P0-1 fortgesetzt)
  - Ausgenommen (rufen `openDb()` bewusst nicht auf): `kanban migrate` selbst,
    `initBoard()`, `importBoard()` — legen die DB immer frisch als v3 an
  - Das Migrationskommando existiert (`kanban migrate`, siehe Added); bis ein
    Board migriert ist, bleibt es bei diesem Abbruch beim Oeffnen

### Fixed

- `kanban sync` konstruierte `TaskService` mit nur 2 statt 3 Argumenten
  (`notesService` fehlte) — jeder Sync-Lauf gegen ein nicht-leeres Board brach
  mit `undefined is not an object (evaluating 'this.notesService.exists')` ab
- MCP `kanban_purge_archive` las `result.purgedCount` statt `result.deletedCount`
  und lieferte deshalb `undefined` in der Tool-Antwort statt der echten Anzahl
- `bunx tsc --noEmit` bereinigt (24 vorbestehende Fehler, davon 13 durch
  `SQLQueryBindings`-Aufrufsyntax in `task-service.ts`/`archive-service.ts`,
  Rest Null-Checks unter `noUncheckedIndexedAccess` sowie ein totes,
  in ink 6.8.0 nie gelesenes `fullScreen`-Feld in `kanban tui`) — reine
  Aufrufsyntax-/Typ-Fixes, keine Verhaltensaenderung

## [0.1.0] - 2026-03-03

### Added

- Board-Initialisierung mit SQLite (`kanban init`)
- Task CRUD: erstellen, lesen, aktualisieren, loeschen
- Task verschieben zwischen Spalten (Backlog, Todo, In Progress, Review, Done)
- Task abschliessen (`kanban done`)
- Board-Status mit Task-Zahlen pro Spalte
- CLI mit 11 Subcommands (init, add, list, move, done, status, delete, archive, restore, purge, tui)
- MCP Server mit 14 Tools fuer Claude Code Integration (stdio Transport)
- Terminal UI (TUI) mit ink + React
  - Spalten-basierte Board-Ansicht mit Farbcodierung
  - Tastatur-Navigation zwischen Spalten und Tasks
  - Task-Erstellung direkt im TUI (`n`)
  - Task-Loeschen mit Bestaetigung (`x`)
  - Filter/Suche nach Titel (`/`)
  - Hilfe-Overlay (`?`)
  - Task-Details, Verschieben, Done-Markierung
- Archiv-Management: archivieren, wiederherstellen, purgen, Statistiken
- Duplikat-Erkennung mit Trigram + Wort-basierter Similarity
- TodoWrite Sync Hook fuer automatische Kanban-Updates
- Pro-Projekt SQLite Datenbank in `.kanban/` Verzeichnis
- Prefix-basierte Task-ID Suche (Kurzform moeglich)
- Unit-Tests mit bun:test (64 Tests)
