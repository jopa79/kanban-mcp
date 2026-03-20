# ralph-kanban-tracker

Kanban MCP Tracker Plugin fuer [Ralph TUI](https://github.com/subsy/ralph-tui) — verbindet Ralph mit JoPas Kanban MCP Board.

## Was macht das Plugin?

```
Planer erstellt Tasks im Kanban
        |
        v
  Ralph TUI (mit kanban-mcp Tracker Plugin)
        |
        v
  Agent arbeitet Tasks autonom ab
        |
        v
  Status-Updates fliessen zurueck ins Kanban
```

Das Plugin liest Tasks aus dem Kanban Board via CLI und stellt sie Ralph als TrackerTasks bereit. Bidirektionale Sync: Ralph kann Tasks als erledigt markieren oder den Status aendern.

## Voraussetzungen

- **Bun** >= 1.0
- **ralph-tui** >= 0.11.0 (`bun install -g ralph-tui`)
- **kanban** CLI (`/opt/homebrew/bin/kanban`)
- Ein Projekt mit initialisiertem `.kanban/` Board

## Installation

```bash
# Repository klonen
git clone <repo-url>
cd ralph-kanban-tracker

# Build und Deploy
bun run deploy
```

Das Deploy-Script bundled das Plugin und kopiert es nach `~/.config/ralph-tui/plugins/trackers/kanban-mcp.js`.

## Konfiguration

Ralph TUI fragt beim Setup nach diesen Optionen:

| Option | Default | Beschreibung |
|--------|---------|-------------|
| `kanbanBin` | `/opt/homebrew/bin/kanban` | Pfad zur Kanban CLI Binary |
| `projectDir` | `.` | Projektverzeichnis mit `.kanban/` Board |

## Status-Mapping

### Kanban → Ralph (Lesen)

| Kanban Column | Ralph Status |
|---------------|-------------|
| todo | open |
| in-progress | in_progress |
| backlog | blocked |
| review | completed |

### Ralph → Kanban (Schreiben)

| Ralph Aktion | Kanban Effekt |
|-------------|--------------|
| completeTask(id) | Task nach `review` verschieben |
| updateTaskStatus(id, 'in_progress') | Task nach `in-progress` verschieben |
| updateTaskStatus(id, 'blocked') | Task nach `backlog` verschieben |

## Task-Priorisierung

`getNextTask()` sortiert Tasks so:
1. Tasks mit Labels `meta` + `plan` zuerst (LIES MICH ZUERST)
2. `in_progress` vor `open` (angefangene Tasks zuerst fertig machen)
3. Position im Board (natuerliche Reihenfolge)

## Development

```bash
# Tests ausfuehren
bun test

# Build (ohne Deploy)
bun run build

# Build + Deploy
bun run deploy
```

## Projektstruktur

```
ralph-kanban-tracker/
├── src/
│   ├── tracker.ts        # Plugin-Klasse + Factory Export
│   ├── cli.ts            # CLI Wrapper (Bun.spawn)
│   ├── mapping.ts        # Kanban Task → TrackerTask Konvertierung
│   └── types.ts          # Kanban CLI Output Types
├── tests/
│   ├── cli.test.ts       # CLI Wrapper Tests
│   ├── mapping.test.ts   # Mapping + Sortierung Tests
│   └── tracker.test.ts   # Integration Tests
├── scripts/
│   └── deploy.ts         # Build + Deploy Script
├── package.json
└── tsconfig.json
```

## Architektur

```
tracker.ts  ──Bun.spawn──►  /opt/homebrew/bin/kanban  ──►  .kanban/board.db
```

Kommunikation via CLI Subprocess — entkoppelt vom Kanban DB-Schema.
