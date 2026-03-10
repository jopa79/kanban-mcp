// SQLite Datenbank Setup und Migration
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BoardConfig } from "./types.ts";

const SCHEMA_VERSION = 2;

// Default-Spalten fuer ein neues Board
const DEFAULT_COLUMNS = [
  { id: "backlog", name: "Backlog", position: 0, wipLimit: 0, isTerminal: false },
  { id: "todo", name: "Todo", position: 1, wipLimit: 0, isTerminal: false },
  { id: "in-progress", name: "In Progress", position: 2, wipLimit: 3, isTerminal: false },
  { id: "review", name: "Review", position: 3, wipLimit: 0, isTerminal: false },
  { id: "done", name: "Done", position: 4, wipLimit: 0, isTerminal: true },
];

// Datenbank oeffnen, migrieren falls noetig
export function openDb(dbPath: string): Database {
  const db = new Database(dbPath);
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  migrateDb(db);
  return db;
}

// Migrationen ausfuehren (idempotent)
function migrateDb(db: Database): void {
  // Pruefen ob schema_version Tabelle existiert (neue DB hat sie noch nicht)
  const tableExists = db.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ).get();
  if (!tableExists) return; // Neue DB — Schema wird spaeter von createSchema erstellt

  const row = db.query("SELECT version FROM schema_version").get() as { version: number } | null;
  const currentVersion = row?.version ?? 0;

  // v1 → v2: position-Feld fuer Task-Reihenfolge
  if (currentVersion < 2) {
    // Pruefen ob Spalte schon existiert (Sicherheit)
    const cols = db.query("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === "position")) {
      db.run("ALTER TABLE tasks ADD COLUMN position INTEGER DEFAULT 0");
      // Bestehende Tasks: Position nach created_at setzen
      db.run(`
        UPDATE tasks SET position = (
          SELECT COUNT(*) FROM tasks t2
          WHERE t2.column_id = tasks.column_id
            AND t2.created_at <= tasks.created_at
            AND t2.id != tasks.id
        )
      `);
      db.run("CREATE INDEX IF NOT EXISTS idx_tasks_position ON tasks(column_id, position)");
    }
    db.run(`UPDATE schema_version SET version = 2`);
  }
}

// Schema erstellen (nur bei neuer DB)
export function createSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS columns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      wip_limit INTEGER DEFAULT 0,
      is_terminal INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
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
    CREATE TABLE IF NOT EXISTS dependencies (
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      depends_on_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      PRIMARY KEY (task_id, depends_on_id)
    )
  `);

  db.run("CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks(column_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tasks_archived ON tasks(archived)");
  db.run("CREATE INDEX IF NOT EXISTS idx_tasks_position ON tasks(column_id, position)");

  // Schema-Version setzen
  const versionRow = db.query("SELECT version FROM schema_version").get();
  if (!versionRow) {
    db.run(`INSERT INTO schema_version (version) VALUES (${SCHEMA_VERSION})`);
  }
}

// Default-Spalten einfuegen
export function seedColumns(db: Database): void {
  const insertCol = db.prepare(
    "INSERT OR IGNORE INTO columns (id, name, position, wip_limit, is_terminal) VALUES (?, ?, ?, ?, ?)"
  );

  for (const col of DEFAULT_COLUMNS) {
    insertCol.run(col.id, col.name, col.position, col.wipLimit, col.isTerminal ? 1 : 0);
  }
}

// Board initialisieren: .kanban/ Ordner + DB + Config
export function initBoard(projectDir: string, boardName: string): string {
  const kanbanDir = join(projectDir, ".kanban");
  const dbPath = join(kanbanDir, "board.db");
  const configPath = join(kanbanDir, "config.json");

  if (existsSync(dbPath)) {
    throw new Error("Board existiert bereits in diesem Verzeichnis");
  }

  // Ordner erstellen
  mkdirSync(kanbanDir, { recursive: true });

  // Config schreiben
  const config: BoardConfig = {
    name: boardName,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  // DB erstellen und Schema + Spalten anlegen
  const db = openDb(dbPath);
  createSchema(db);
  seedColumns(db);
  db.close();

  return kanbanDir;
}

// Prueft ob ein Board im Verzeichnis existiert
export function boardExists(projectDir: string): boolean {
  return existsSync(join(projectDir, ".kanban", "board.db"));
}

// Pfade zum Board im Verzeichnis
export function getBoardPaths(projectDir: string) {
  const kanbanDir = join(projectDir, ".kanban");
  return {
    kanbanDir,
    dbPath: join(kanbanDir, "board.db"),
    configPath: join(kanbanDir, "config.json"),
  };
}
