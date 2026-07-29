# kanban-mcp

Terminal-basiertes Kanban Board mit MCP-Server fuer Claude Code.

- **CLI** — Alle Board-Operationen direkt im Terminal
- **TUI** — Interaktive Board-Ansicht mit Tastatur-Navigation
- **MCP Server** — 16 Tools fuer Claude Code Integration
- **Skills** — Automatisierte Review-Tests (Playwright + VHS)
- **SQLite** — Pro-Projekt Datenbank in `.kanban/`

## Screenshots

![Kanban TUI](docs/tui-screenshot.png)

![Task Detail-Ansicht](docs/tui-detail.png)

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
# Task erstellen -- nur Backlog/Todo sind Eintrittsspalten (Zustandsmaschine, 0.2.0)
kanban add "Task Titel" -d "Beschreibung" -c backlog

# Tasks auflisten
kanban list                  # Alle Tasks
kanban list -c todo          # Nur aus Todo-Spalte

# Task verschieben / abschliessen -- die Spaltenkette ist vorwaerts strikt
# (max. ein Schritt), rueckwaerts frei; done braucht Review davor
kanban move <id> in-progress
kanban done <id>

# --by <name> an add/move/done: wer meldet die Aenderung (default: user).
# Wird in transitions.reported_by protokolliert, nicht auf dem Task selbst.
kanban move <id> in-progress --by backend

# Task aendern / loeschen
kanban delete <id>

# Board-Status
kanban status

# Archiv
kanban archive              # Done-Tasks archivieren
kanban restore <id>         # Wiederherstellen
kanban purge --confirm      # Archiv loeschen
```

## TodoWrite Sync (Claude Code Hook)

`kanban sync` liest den TodoWrite-Hook-Payload von stdin und gleicht ihn mit
dem Board ab. Als `PostToolUse`-Hook fuer `TodoWrite` in `~/.claude/settings.json`
registrieren:

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "TodoWrite", "hooks": [{ "type": "command", "command": "kanban sync" }] }
    ]
  }
}
```

**Verhalten:**
- Todos werden per **Titel-Vergleich** mit bestehenden Tasks abgeglichen
  (TodoWrite liefert keine ID, siehe Einschraenkung unten). Bei mehreren
  gleichnamigen Tasks gewinnt deterministisch der **aelteste, nicht
  archivierte** — archivierte Tasks werden nie getroffen, und zwei
  gleichnamige Todos im selben Aufruf landen auf zwei verschiedenen Tasks
- Ein Todo meldet einen **Zielzustand**, keinen Weg dorthin. Liegt die
  Zielspalte mehr als einen Schritt entfernt (z.B. ein neuer, sofort
  `completed` gemeldeter Todo), durchlaeuft der Task jede Zwischenspalte als
  eigene, protokollierte Transition (`reason: "reconcile"`, `reportedBy:
  "sync"`) — die Zustandsmaschine wird nicht umgangen, auch wenn alle
  Zwischenschritte in derselben Sekunde passieren
- **WIP-Ueberschreitungen werden protokolliert, nicht abgelehnt** (TodoWrite
  selbst laesst sich nicht ablehnen — der Hook laeuft, nachdem Claude Code den
  Zustand bereits gesetzt hat). Meldung auf stderr, `kanban status` zeigt die
  ueberfuellte Spalte
- Ist der zugehoerige Task durch eine **offene Abhaengigkeit blockiert**, wird
  das Todo **uebersprungen** statt bewegt — anders als beim WIP-Limit, das der
  Sync reissen darf, ist eine offene Abhaengigkeit eine Tatsache: der Task ist
  noch nicht dran. Meldung auf stderr nennt Task und wartende Abhaengigkeit(en);
  alle uebrigen Todos desselben Aufrufs laufen normal weiter
- Verschwundene Todos werden **ignoriert** — ein fehlendes Todo im naechsten
  Aufruf koennte "abgebrochen" heissen oder schlicht "Liste gekuerzt"; aus dem
  Payload nicht unterscheidbar. Der Sync loescht und archiviert nie
- Ein Board-Problem (nicht migriertes Schema, kaputte `config.json`) meldet
  sich auf stderr mit **Exit 0** — ein Hook, der einen Agenten-Turn mit
  Exit 1 stoert, richtet mehr Schaden an als ein ausgefallener Sync

**Bekannte Einschraenkung:** TodoWrite liefert keine stabile ID pro Todo, nur
`content`, `status` und `activeForm`. Wird ein aus einem Todo entstandener
Task im TUI oder per CLI **umbenannt**, erkennt der naechste Sync ihn nicht
wieder (der Titel passt nicht mehr) und legt einen zweiten Task an. Das ist
keine Fehlfunktion, sondern eine prinzipielle Grenze der verfuegbaren Daten —
mit den Feldern, die TodoWrite liefert, ist die Identitaet eines Todos ueber
Umbenennungen hinweg nicht rekonstruierbar.

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
| `kanban_add_task` | Task erstellen (Pflichtfeld `reportedBy`, nur Backlog/Todo) |
| `kanban_add_task_checked` | Task mit Duplikat-Pruefung erstellen (Pflichtfeld `reportedBy`) |
| `kanban_get_task` | Task per ID abrufen |
| `kanban_list_tasks` | Tasks auflisten (mit Filtern) |
| `kanban_move_task` | Task verschieben (Pflichtfeld `reportedBy`) |
| `kanban_update_task` | Task-Eigenschaften aendern |
| `kanban_delete_task` | Task loeschen |
| `kanban_complete_task` | Task abschliessen (Pflichtfeld `reportedBy`, nur aus Review) |
| `kanban_status` | Board-Uebersicht |
| `kanban_archive_tasks` | Tasks archivieren |
| `kanban_restore_task` | Archivierten Task wiederherstellen |
| `kanban_purge_archive` | Archiv permanent loeschen |
| `kanban_archive_stats` | Archiv-Statistiken |
| `kanban_export_board` | Board als JSON exportieren |
| `kanban_import_board` | Board aus JSON importieren |

**`reportedBy`** (seit 0.2.0, Breaking Change): die vier oben markierten
Tools verlangen den Rollennamen des aufrufenden Agents (`planer`, `backend`,
`frontend`, `code-reviewer`, `teamlead`, `explorer`; bei direkter Nutzung
durch einen Menschen `user`). Der Wert landet ausschliesslich in der
Transitions-Historie des Tasks, nicht auf dem Task selbst. Aufrufe ohne
`reportedBy` scheitern mit einem Validierungsfehler. In CLI und TUI bleibt es
optional (`--by <name>`, Default `user`).

**Zustandsmaschine** (seit 0.2.0, Breaking Change): `kanban_add_task`
akzeptiert nur noch Spalten mit `allowEntry: true` (Backlog, Todo im
Default-Board). `kanban_move_task` und `kanban_complete_task` koennen
ablehnen — die Spaltenkette ist vorwaerts strikt (maximal ein Schritt),
rueckwaerts beliebig frei, und `kanban_complete_task` verlangt, dass der Task
in der Spalte direkt vor der Terminal-Spalte steht (Default: Review). Jede
Ablehnung kommt mit `isError: true` und nennt den naechsten gueltigen
Schritt.

## Skills

Im Ordner `skills/` liegen Claude Code Skills die auf dem Kanban MCP aufbauen.

### kanban-review-tester

Testet automatisch alle Kanban-Tasks im Status "Review". Erkennt pro Task ob ein Browser-Test (Playwright) oder Terminal-Test (VHS) noetig ist.

**Features:**
- Automatische Test-Typ-Erkennung anhand von Task-Titel, Notes und Labels
- Browser-Tests via Playwright MCP (UI, Console, Netzwerk)
- Terminal-Tests via VHS + Bash (CLI-Befehle, Builds, Migrations)
- Ergebnisse werden direkt in die Task-Notes geschrieben

**Einrichten:**

```bash
# Symlink in Claude Code Skills-Ordner
ln -s /pfad/zu/kanban-mcp/skills/kanban-review-tester ~/.claude/skills/kanban-review-tester
```

**Ausfuehren:** "teste die Reviews" oder "review testen" zu Claude sagen.

## Tests

```bash
bun test
```

## Projektstruktur

```
kanban-mcp/
  skills/
    kanban-review-tester/
      SKILL.md              # Review-Test Skill fuer Claude Code
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
