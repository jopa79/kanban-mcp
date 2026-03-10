# Changelog

Alle wesentlichen Aenderungen an diesem Projekt werden hier dokumentiert.

Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.0.0/),
Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Added

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
