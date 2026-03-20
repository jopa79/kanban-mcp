# Changelog

Alle Aenderungen an diesem Projekt werden hier dokumentiert.
Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/).
Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [0.1.0] - 2026-03-20

### Added
- Kanban MCP Tracker Plugin fuer Ralph TUI
- CLI Subprocess Kommunikation mit Kanban MCP (`list --json`, `get --json`, `move`, `status --json`)
- Status-Mapping: Kanban Columns ↔ Ralph TrackerTask Status
- LIES MICH ZUERST Priorisierung (meta+plan Labels in getNextTask)
- Setup Questions fuer ralph-tui init (kanbanBin, projectDir)
- Handlebars Prompt Template mit Task Notes Support
- Deploy Script fuer User-Plugin Installation nach `~/.config/ralph-tui/plugins/trackers/`
- `--json` Flag fuer Kanban CLI (list, status) und neuer `get` Befehl (Prerequisite)
- 50 Tests (CLI, Mapping, Integration)
