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
- Markdown-Notizen pro Task (`.kanban/notes/<id>.md`)
  - `kanban add -n "text"` — Notizen beim Erstellen mitgeben
  - `kanban note <id>` — Notizen im `$EDITOR` oeffnen
  - MCP Tools: `notes` Parameter bei `kanban_add_task`, `kanban_update_task`, `kanban_add_task_checked`
  - MCP `kanban_get_task` liefert Notes-Inhalt mit
  - TUI: Notes-Anzeige in Detail-Ansicht, `e` zum Editieren, `[N]`-Indikator auf Task-Karten
  - `hasNotes` Flag bei `listTasks` (Performance: kein Datei-Inhalt laden)

### Changed

- `BoardService` liest Spalten jetzt aus `config.json` statt per SQL aus der
  `columns`-Tabelle (`getColumns`, `getColumn`, `getTerminalColumn`); die
  `columns`-Tabelle entfaellt, `tasks.column_id` hat keinen Fremdschluessel
  mehr darauf. `getColumnTaskCount` bleibt SQL — zaehlt Tasks, nicht Spalten
- DB-Schema-Version 2 → 3. `openDb()` migriert nicht mehr automatisch beim
  Oeffnen (bisheriges `migrateDb()` entfernt) — bei einer aelteren
  Schema-Version bricht das Oeffnen mit Pfad und Hinweis auf `kanban migrate`
  ab. Das Migrationskommando selbst folgt in einem separaten Task; bis dahin
  betrifft das nur Boards, die vor diesem Change angelegt wurden
- Bekannte Einschraenkung (vorerst): `kanban import` eines v2-ZIP-Archivs
  schreibt Spalten noch in die nicht mehr existierende `columns`-Tabelle und
  schlaegt deshalb aktuell fehl. v2-Import-Kompatibilitaet ist als eigener
  Task vorgemerkt

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
