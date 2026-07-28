// SQLite Datenbank Setup und Migration
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BoardConfig, ColumnConfig } from "./types.ts";
import { validateBoardConfig } from "./types.ts";

const SCHEMA_VERSION = 3;

// Default-Spalten fuer ein neues Board — leben seit Schema v3 in config.json,
// nicht mehr in der DB (ADR 0001). Kein 'position': die Array-Reihenfolge ist
// die Reihenfolge. 'allowEntry' nur fuer Backlog/Todo — 'done' bewusst false,
// sonst waere die addTask-Hintertuer zur Terminal-Spalte offen.
const DEFAULT_COLUMNS: ColumnConfig[] = [
  { id: "backlog", name: "Backlog", wipLimit: 0, allowEntry: true, isTerminal: false },
  { id: "todo", name: "Todo", wipLimit: 0, allowEntry: true, isTerminal: false },
  { id: "in-progress", name: "In Progress", wipLimit: 3, allowEntry: false, isTerminal: false },
  { id: "review", name: "Review", wipLimit: 0, allowEntry: false, isTerminal: false },
  { id: "done", name: "Done", wipLimit: 0, allowEntry: false, isTerminal: true },
];

// Datenbank oeffnen
export function openDb(dbPath: string): Database {
  const db = new Database(dbPath);
  // busy_timeout zuerst — damit nachfolgende Operationen bei konkurrierenden Zugriffen warten
  db.run("PRAGMA busy_timeout = 5000");
  // WAL ist persistent — nur setzen wenn noch nicht aktiv (vermeidet unnoetige Schreibzugriffe)
  const mode = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
  if (mode.journal_mode !== "wal") {
    db.run("PRAGMA journal_mode = WAL");
  }
  // foreign_keys muss pro Connection gesetzt werden (nicht persistent)
  db.run("PRAGMA foreign_keys = ON");
  assertSchemaNotStale(db, dbPath);
  return db;
}

// Notbremse (P0-1, vorlaeufig): migrateDb() lief frueher unbeaufsichtigt in jedem
// openDb() mit — das entfaellt, Migration ist jetzt explizit ueber 'kanban migrate'
// (P0-4). Damit zwischen diesem Task und dem umfassenden Schema-Guard aus P0-5
// niemand ein bestehendes v2-Board still mit v3-Code oeffnet, bricht das Oeffnen
// hier hart ab, wenn die Schema-Version veraltet ist. Eine neue, noch leere DB
// (keine schema_version-Tabelle) ist kein Fehlerfall — createSchema() legt sie
// gleich an. P0-5 ersetzt diesen Block durch den vollstaendigeren Guard.
function assertSchemaNotStale(db: Database, dbPath: string): void {
  const tableExists = db.query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ).get();
  if (!tableExists) return; // Neue DB — Schema wird gleich von createSchema erstellt

  const row = db.query("SELECT version FROM schema_version").get() as { version: number } | null;
  const currentVersion = row?.version ?? 0;
  if (currentVersion < SCHEMA_VERSION) {
    throw new Error(
      `Board-Schema ist Version ${currentVersion}, benoetigt wird ${SCHEMA_VERSION}.\n` +
      `Datei: ${dbPath}\n` +
      `Fuehre 'kanban migrate' aus. Ein Backup wird dabei automatisch angelegt.`
    );
  }
}

// Schema erstellen (nur bei neuer DB)
export function createSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL
    )
  `);

  // 'column_id' hat seit Schema v3 bewusst KEINEN Fremdschluessel mehr —
  // Spalten leben in config.json, nicht mehr in der DB (ADR 0001). Ein Task
  // kann damit auf eine Spalte zeigen, die in der Config fehlt (Waisen-Fall,
  // siehe getOrphanColumnIds in board-service.ts); das ist gewollt, kein Bug.
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      column_id TEXT NOT NULL,
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

  // Config schreiben — Spalten leben seit Schema v3 in config.json, nicht mehr
  // in der DB (ADR 0001). Kein separates seedColumns() mehr noetig.
  const config: BoardConfig = {
    name: boardName,
    createdAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    columns: DEFAULT_COLUMNS,
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  // DB erstellen und Schema anlegen
  const db = openDb(dbPath);
  createSchema(db);
  db.close();

  return kanbanDir;
}

// Config von Platte laden und validieren. Fehlermeldung nennt Pfad und Grund,
// kein Stacktrace — verstaendlich fuer CLI-Nutzer und Agents gleichermassen.
export function loadBoardConfig(configPath: string): BoardConfig {
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch {
    throw new Error(`config.json nicht lesbar. Datei: ${configPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`config.json ist kein gueltiges JSON. Datei: ${configPath}`);
  }

  try {
    return validateBoardConfig(parsed);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`${reason}\nDatei: ${configPath}`);
  }
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
