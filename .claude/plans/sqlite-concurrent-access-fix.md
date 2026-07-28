# Plan: SQLite Concurrent Access Fix

## Problem

Wenn MCP-Server und TUI gleichzeitig auf die Kanban-DB (`.kanban/board.db`) zugreifen,
kommt es zu SQLite-Locks. Zwei Ursachen:

1. **WAL wird unnoetig bei jedem `openDb()` neu gesetzt** — WAL-Mode ist persistent,
   muss nur einmal gesetzt werden. `PRAGMA journal_mode = WAL` ist selbst ein
   Schreibvorgang und erzeugt Locks.

2. **MCP-Server schliesst DB-Verbindungen nie** — `getContext()` oeffnet eine neue
   DB-Verbindung pro Tool-Aufruf, aber die `db`-Referenz wird nicht zurueckgegeben
   und nie geschlossen. Verbindungen akkumulieren sich, DB wird dauerhaft gelockt.

## Ist-Zustand

```
TUI:  openDb() → Operation → db.close()    ← sauber (Vorbild!)
CLI:  openDb() → Operation → process.exit() ← OK (OS schliesst)
MCP:  openDb() → Operation → ???            ← DB bleibt offen! (BUG)
```

- `busy_timeout = 5000` ist bereits implementiert (Commit 22be346)
- WAL und foreign_keys werden bereits gesetzt
- 13 MCP-Tool-Handler betroffen (tools.ts: 6, tools-archive.ts: 4, tools-extras.ts: 3)

## Loesung: 3 Aenderungen

### Aenderung 1: `src/core/db.ts` — WAL nur wenn noetig (klein)

**Datei:** `src/core/db.ts`, Zeilen 19-26

**Vorher:**
```typescript
export function openDb(dbPath: string): Database {
  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");
  migrateDb(db);
  return db;
}
```

**Nachher:**
```typescript
export function openDb(dbPath: string): Database {
  const db = new Database(dbPath);
  db.run("PRAGMA busy_timeout = 5000");
  // WAL ist persistent — nur setzen wenn noch nicht aktiv (vermeidet unnoetige Schreibzugriffe)
  const mode = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
  if (mode.journal_mode !== "wal") {
    db.run("PRAGMA journal_mode = WAL");
  }
  db.run("PRAGMA foreign_keys = ON");
  migrateDb(db);
  return db;
}
```

**Wichtig:**
- `busy_timeout` muss ZUERST gesetzt werden (vor dem WAL-Check), damit der Check selbst
  nicht sofort failt wenn ein anderer Prozess die DB haelt
- `busy_timeout` und `foreign_keys` muessen pro Connection gesetzt werden (nicht persistent)
- WAL ist persistent und ueberlebt DB-Neustarts

### Aenderung 2: `src/mcp/mcp-context.ts` — `withContext()` Pattern (mittel)

**Datei:** `src/mcp/mcp-context.ts`

Neues Pattern nach TUI-Vorbild (`use-board.ts` Zeilen 30-35 — `withServices()`):

```typescript
// NEU: DB oeffnen, Aktion ausfuehren, DB garantiert schliessen
export function withContext<T>(workingDir: string, action: (ctx: McpContext) => T): T {
  if (!boardExists(workingDir)) {
    throw new Error("Kein Board gefunden. Zuerst kanban_init aufrufen.");
  }

  const paths = getBoardPaths(workingDir);
  const db = openDb(paths.dbPath);
  const config: BoardConfig = JSON.parse(readFileSync(paths.configPath, "utf-8"));
  const boardService = new BoardService(db);
  const notesService = new NotesService(paths.kanbanDir);
  const taskService = new TaskService(db, boardService, notesService);

  try {
    return action({ boardService, taskService, notesService, config });
  } finally {
    db.close();
  }
}
```

- `getContext()` bleibt bestehen (wird noch von keinem externen Code genutzt, aber Sicherheit)
- `withContext()` wird zum neuen Standard fuer MCP-Tools
- `finally`-Block garantiert `db.close()` auch bei Exceptions

### Aenderung 3: `src/mcp/tools*.ts` — 13 Tool-Handler migrieren (mechanisch)

**Dateien:** `tools.ts`, `tools-archive.ts`, `tools-extras.ts`

**Pattern vorher:**
```typescript
async ({ title, ... }) => {
  try {
    const { taskService } = getContext(workingDir);
    const result = taskService.doSomething(...);
    return { content: [{ type: "text", text: `Ergebnis: ${result}` }] };
  } catch (err) {
    return { content: [{ type: "text", text: `Fehler: ${(err as Error).message}` }], isError: true };
  }
}
```

**Pattern nachher:**
```typescript
async ({ title, ... }) => {
  try {
    return withContext(workingDir, ({ taskService }) => {
      const result = taskService.doSomething(...);
      return { content: [{ type: "text", text: `Ergebnis: ${result}` }] };
    });
  } catch (err) {
    return { content: [{ type: "text", text: `Fehler: ${(err as Error).message}` }], isError: true };
  }
}
```

**Betroffene Stellen (13 total):**

`tools.ts` (6 Handler):
- kanban_add_task (Zeile 54)
- kanban_list_tasks (Zeile 77)
- kanban_get_task (Zeile 103)
- kanban_move_task (Zeile 125)
- kanban_update_task (Zeile 151)
- kanban_delete_task (Zeile 172)

`tools-archive.ts` (4 Handler):
- kanban_archive_tasks (Zeile 21)
- kanban_restore_task (Zeile 44)
- kanban_purge_archive (Zeile 66)
- kanban_archive_stats (Zeile 92)

`tools-extras.ts` (3 Handler):
- kanban_add_task_checked (Zeile 27)
- kanban_complete_task (Zeile 55)
- kanban_status (Zeile 77)

**Import-Aenderung in allen 3 Dateien:**
```typescript
// Vorher:
import { getContext } from "./mcp-context.ts";
// Nachher:
import { withContext } from "./mcp-context.ts";
```

## Nicht im Scope

- **cli/context.ts** — CLI-Befehle enden mit `process.exit()`, OS schliesst die DB.
  Kein echtes Problem, Konsistenz-Fix kann spaeter erfolgen.
- **export-service.ts** — Oeffnet eigene DB, ist aber nur bei Export/Import aktiv
  und kurzlebig. Kein Locking-Problem.

## Reihenfolge der Umsetzung

1. **db.ts** — WAL-Fix (unabhaengig, kann parallel)
2. **mcp-context.ts** — withContext einfuehren (unabhaengig von 1, kann parallel)
3. **tools*.ts** — Handler migrieren (haengt von 2 ab, braucht withContext)

## Verifikation

Nach der Implementierung testen:
1. `bun test` — Alle bestehenden Tests muessen gruen sein
2. MCP-Server starten + TUI gleichzeitig oeffnen — kein Lock mehr
3. Mehrere Tool-Aufrufe hintereinander — DB darf nicht gelockt bleiben
4. `PRAGMA journal_mode` nur einmal in den Logs bei Erstaufruf

## Risiko

Minimal — die TUI beweist bereits dass das `withServices()`-Pattern funktioniert.
Es wird 1:1 auf den MCP-Server uebertragen.
