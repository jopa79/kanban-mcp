// Test-Helfer: temporaeres Board erstellen und aufraeumen
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { initBoard, openDb, getBoardPaths, loadBoardConfig } from "../src/core/db.ts";
import { BoardService } from "../src/core/board-service.ts";
import { TaskService } from "../src/core/task-service.ts";
import { NotesService } from "../src/core/notes-service.ts";

export interface TestContext {
  dir: string;
  db: Database;
  boardService: BoardService;
  taskService: TaskService;
  notesService: NotesService;
  cleanup: () => void;
}

// Erstellt ein temporaeres Board mit allen Services
export function createTestBoard(name = "Test Board"): TestContext {
  const dir = mkdtempSync(join(tmpdir(), "kanban-test-"));
  initBoard(dir, name);
  const paths = getBoardPaths(dir);
  const db = openDb(paths.dbPath);
  const config = loadBoardConfig(paths.configPath);
  const boardService = new BoardService(db, config);
  const notesService = new NotesService(paths.kanbanDir);
  const taskService = new TaskService(db, boardService, notesService);

  const cleanup = () => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  };

  return { dir, db, boardService, taskService, notesService, cleanup };
}

// --- v2-Fixture fuer Migrations-Tests (P0-4) ---
//
// Bildet exakt den Schema-v2-Zustand nach, den migrate-v3.ts als Eingabe
// erwartet: 'columns'-Tabelle mit position/wip_limit/is_terminal, 'tasks' MIT
// Fremdschluessel auf columns(id) und OHNE priority/due_date, config.json OHNE
// 'columns'-Feld (belegt anhand eines echten, vor der Migration liegenden
// Boards — siehe Task-Kontext). Absichtlich nicht ueber initBoard()/createSchema()
// gebaut, sonst wuerde der Fixture-Code denselben Weg gehen wie der Code, der
// getestet werden soll.
export interface LegacyColumnFixture {
  id: string;
  name: string;
  position: number;
  wipLimit?: number;
  isTerminal?: boolean;
}

export interface LegacyBoardContext {
  dir: string;
  dbPath: string;
  configPath: string;
  db: Database;
  cleanup: () => void;
}

const DEFAULT_LEGACY_COLUMNS: LegacyColumnFixture[] = [
  { id: "backlog", name: "Backlog", position: 0 },
  { id: "todo", name: "Todo", position: 1 },
  { id: "in-progress", name: "In Progress", position: 2, wipLimit: 3 },
  { id: "review", name: "Review", position: 3 },
  { id: "done", name: "Done", position: 4, isTerminal: true },
];

export function createLegacyV2Board(options?: {
  columns?: LegacyColumnFixture[];
  boardName?: string;
}): LegacyBoardContext {
  const dir = mkdtempSync(join(tmpdir(), "kanban-v2-test-"));
  const kanbanDir = join(dir, ".kanban");
  mkdirSync(kanbanDir, { recursive: true });
  const dbPath = join(kanbanDir, "board.db");
  const configPath = join(kanbanDir, "config.json");

  // Echtes v2-config.json kennt weder 'schemaVersion' noch 'columns' (belegt).
  writeFileSync(
    configPath,
    JSON.stringify({ name: options?.boardName ?? "Legacy Board", createdAt: new Date().toISOString() }),
  );

  const db = new Database(dbPath);
  db.run("PRAGMA foreign_keys = ON");
  db.run("CREATE TABLE schema_version (version INTEGER NOT NULL)");
  db.run("INSERT INTO schema_version (version) VALUES (2)");
  db.run(`
    CREATE TABLE columns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      wip_limit INTEGER DEFAULT 0,
      is_terminal INTEGER DEFAULT 0
    )
  `);
  db.run(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      column_id TEXT NOT NULL REFERENCES columns(id),
      created_by TEXT DEFAULT 'user',
      assigned_to TEXT,
      labels TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived INTEGER DEFAULT 0,
      version INTEGER DEFAULT 1,
      position INTEGER DEFAULT 0
    )
  `);
  db.run(`
    CREATE TABLE dependencies (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, depends_on_id)
    )
  `);
  db.run("CREATE INDEX idx_tasks_column ON tasks(column_id)");
  db.run("CREATE INDEX idx_tasks_archived ON tasks(archived)");
  db.run("CREATE INDEX idx_tasks_position ON tasks(column_id, position)");

  const columns = options?.columns ?? DEFAULT_LEGACY_COLUMNS;
  const insertCol = db.prepare(
    "INSERT INTO columns (id, name, position, wip_limit, is_terminal) VALUES (?, ?, ?, ?, ?)",
  );
  for (const c of columns) {
    insertCol.run(c.id, c.name, c.position, c.wipLimit ?? 0, c.isTerminal ? 1 : 0);
  }

  const cleanup = () => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  };

  return { dir, dbPath, configPath, db, cleanup };
}

// Fuegt einen rohen v2-Task per SQL ein (kein priority/due_date-Feld in v2).
// 'columnId' darf bewusst auf eine nicht existierende Spalte zeigen (Waisen-Test) —
// dafuer foreign_keys kurz aus- und wieder einschalten, sonst verweigert SQLite
// den Insert selbst.
export function insertLegacyTask(
  db: Database,
  task: {
    id: string;
    title: string;
    columnId: string;
    position?: number;
    archived?: boolean;
    orphan?: boolean;
  },
): void {
  const now = new Date().toISOString();
  if (task.orphan) db.run("PRAGMA foreign_keys = OFF");
  db.run(
    `INSERT INTO tasks (id, title, column_id, created_by, created_at, updated_at, archived, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [task.id, task.title, task.columnId, "user", now, now, task.archived ? 1 : 0, task.position ?? 0],
  );
  if (task.orphan) db.run("PRAGMA foreign_keys = ON");
}
