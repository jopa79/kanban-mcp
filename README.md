# kanban-mcp

Terminal-basiertes Kanban Board mit MCP-Server fuer Claude Code.

- **CLI** — Alle Board-Operationen direkt im Terminal
- **TUI** — Interaktive Board-Ansicht mit Tastatur-Navigation
- **MCP Server** — 16 Tools fuer Claude Code Integration
- **SQLite** — Pro-Projekt Datenbank in `.kanban/`

## Setup

```bash
# Dependencies installieren
bun install

# Board im aktuellen Verzeichnis initialisieren
bun run src/index.ts init

# Optional: Board-Name angeben
bun run src/index.ts init "Mein Projekt"
```

## CLI Commands

```bash
# Task erstellen
kanban add "Task Titel" -d "Beschreibung" -c in-progress

# Tasks auflisten
kanban list                  # Alle Tasks
kanban list -c todo          # Nur aus Todo-Spalte

# Task verschieben / abschliessen
kanban move <id> in-progress
kanban done <id>

# Task aendern / loeschen
kanban delete <id>

# Board-Status
kanban status

# Archiv
kanban archive              # Done-Tasks archivieren
kanban restore <id>         # Wiederherstellen
kanban purge --confirm      # Archiv loeschen
```

## TUI (Terminal UI)

```bash
kanban tui
```

**Tastaturkuerzel:**

| Taste | Aktion |
|---|---|
| Pfeiltasten | Zwischen Spalten/Tasks navigieren |
| Enter | Task-Details anzeigen |
| n | Neuen Task erstellen |
| > / < | Task in Nachbarspalte verschieben |
| d | Task als Done markieren |
| x | Task loeschen (mit Bestaetigung) |
| / | Tasks nach Titel filtern |
| Esc | Filter aufheben / Zurueck |
| r | Board neu laden |
| ? | Hilfe anzeigen |
| q | TUI beenden |

## MCP Server

Als Claude Code MCP Server registrieren (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "kanban-mcp": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "/pfad/zu/kanban-mcp/src/index.ts", "mcp"],
      "env": { "BUN_BE_BUN": "1" }
    }
  }
}
```

**Verfuegbare MCP Tools:**

| Tool | Beschreibung |
|---|---|
| `kanban_init` | Board initialisieren |
| `kanban_add_task` | Task erstellen |
| `kanban_add_task_checked` | Task mit Duplikat-Pruefung erstellen |
| `kanban_get_task` | Task per ID abrufen |
| `kanban_list_tasks` | Tasks auflisten (mit Filtern) |
| `kanban_move_task` | Task verschieben |
| `kanban_update_task` | Task-Eigenschaften aendern |
| `kanban_delete_task` | Task loeschen |
| `kanban_complete_task` | Task abschliessen |
| `kanban_status` | Board-Uebersicht |
| `kanban_archive_tasks` | Tasks archivieren |
| `kanban_restore_task` | Archivierten Task wiederherstellen |
| `kanban_purge_archive` | Archiv permanent loeschen |
| `kanban_archive_stats` | Archiv-Statistiken |
| `kanban_export_board` | Board als JSON exportieren |
| `kanban_import_board` | Board aus JSON importieren |

## Tests

```bash
bun test
```

## Projektstruktur

```
kanban-mcp/
  src/
    index.ts              # CLI Entry Point
    core/
      db.ts               # SQLite Setup, Migrationen
      types.ts            # TypeScript Types + Converter
      board-service.ts    # Board/Spalten-Verwaltung
      task-service.ts     # Task CRUD + Duplikat-Check
      archive-service.ts  # Archiv-Management
      similarity.ts       # Trigram/Wort-Similarity
    mcp/
      server.ts           # MCP Server (stdio)
      tools.ts            # Core MCP Tools
      tools-archive.ts    # Archiv MCP Tools
      tools-extras.ts     # Duplikat-Check, Status, Complete
      mcp-context.ts      # DB-Kontext fuer MCP
    cli/
      context.ts          # DB-Kontext fuer CLI
      formatters.ts       # Terminal-Ausgabe
      commands/            # CLI Subcommands
    tui/
      app.tsx             # Ink Root Component
      board-view.tsx      # Board-Darstellung
      task-card.tsx       # Task-Karte
      detail-view.tsx     # Task-Details
      help-view.tsx       # Hilfe-Overlay
      status-bar.tsx      # Statuszeile + Eingaben
      use-board.ts        # Custom Hook fuer Board-Daten
  tests/                  # bun:test Unit-Tests
```

## Tech Stack

- **Bun** — Runtime + Test Runner
- **TypeScript** — Typsicherheit
- **bun:sqlite** — Datenbank (built-in)
- **@modelcontextprotocol/sdk** — MCP Server
- **commander** — CLI Framework
- **ink + React** — Terminal UI
- **nanoid** — ID-Generierung
