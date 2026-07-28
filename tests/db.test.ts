// Tests fuer Datenbank-Setup und Board-Initialisierung
import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Database } from "bun:sqlite";
import { initBoard, boardExists, getBoardPaths, openDb, loadBoardConfig } from "../src/core/db.ts";

describe("db", () => {
  const dirs: string[] = [];
  const cleanup = () => dirs.forEach(d => rmSync(d, { recursive: true, force: true }));
  afterEach(cleanup);

  function tmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "kanban-db-test-"));
    dirs.push(dir);
    return dir;
  }

  test("initBoard erstellt .kanban Verzeichnis", () => {
    const dir = tmpDir();
    initBoard(dir, "Test");
    expect(existsSync(join(dir, ".kanban"))).toBe(true);
    expect(existsSync(join(dir, ".kanban", "board.db"))).toBe(true);
    expect(existsSync(join(dir, ".kanban", "config.json"))).toBe(true);
  });

  test("boardExists gibt false fuer leeres Verzeichnis", () => {
    const dir = tmpDir();
    expect(boardExists(dir)).toBe(false);
  });

  test("boardExists gibt true nach initBoard", () => {
    const dir = tmpDir();
    initBoard(dir, "Test");
    expect(boardExists(dir)).toBe(true);
  });

  test("initBoard wirft Fehler bei doppelter Initialisierung", () => {
    const dir = tmpDir();
    initBoard(dir, "Test");
    expect(() => initBoard(dir, "Test")).toThrow();
  });

  test("getBoardPaths liefert korrekte Pfade", () => {
    const dir = tmpDir();
    const paths = getBoardPaths(dir);
    expect(paths.kanbanDir).toBe(join(dir, ".kanban"));
    expect(paths.dbPath).toBe(join(dir, ".kanban", "board.db"));
    expect(paths.configPath).toBe(join(dir, ".kanban", "config.json"));
  });

  test("DB hat korrekte Tabellen nach initBoard, keine columns-Tabelle mehr (ADR 0001)", () => {
    const dir = tmpDir();
    initBoard(dir, "Test");
    const db = openDb(getBoardPaths(dir).dbPath);
    const tables = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>;
    db.close();

    const tableNames = tables.map(t => t.name);
    expect(tableNames).not.toContain("columns");
    expect(tableNames).toContain("tasks");
    expect(tableNames).toContain("dependencies");
  });

  test("schema_version ist 3 nach initBoard", () => {
    const dir = tmpDir();
    initBoard(dir, "Test");
    const db = openDb(getBoardPaths(dir).dbPath);
    const row = db.query("SELECT version FROM schema_version").get() as { version: number };
    db.close();

    expect(row.version).toBe(3);
  });

  test("config.json hat Default-Spalten nach initBoard", () => {
    const dir = tmpDir();
    initBoard(dir, "Test");
    const config = loadBoardConfig(getBoardPaths(dir).configPath);

    expect(config.columns.map(c => c.id)).toEqual(["backlog", "todo", "in-progress", "review", "done"]);
    expect(config.schemaVersion).toBe(3);
  });

  test("config.json-Spalten haben kein 'position'-Feld — Array-Reihenfolge ist die Ordnung", () => {
    const dir = tmpDir();
    initBoard(dir, "Test");
    const raw = JSON.parse(readFileSync(getBoardPaths(dir).configPath, "utf-8")) as {
      columns: Array<Record<string, unknown>>;
    };

    for (const col of raw.columns) {
      expect(col).not.toHaveProperty("position");
    }
  });

  test("allowEntry: Backlog und Todo erlauben Eintritt, der Rest nicht", () => {
    const dir = tmpDir();
    initBoard(dir, "Test");
    const config = loadBoardConfig(getBoardPaths(dir).configPath);
    const byId = Object.fromEntries(config.columns.map(c => [c.id, c.allowEntry]));

    expect(byId.backlog).toBe(true);
    expect(byId.todo).toBe(true);
    expect(byId["in-progress"]).toBe(false);
    expect(byId.review).toBe(false);
    expect(byId.done).toBe(false);
  });

  test("done ist die einzige Terminal-Spalte", () => {
    const dir = tmpDir();
    initBoard(dir, "Test");
    const config = loadBoardConfig(getBoardPaths(dir).configPath);
    const terminal = config.columns.filter(c => c.isTerminal);

    expect(terminal).toHaveLength(1);
    expect(terminal[0]!.id).toBe("done");
  });

  test("openDb wirft Fehler bei veralteter Schema-Version (Notbremse vor P0-4/P0-5)", () => {
    const dir = tmpDir();
    const kanbanDir = join(dir, ".kanban");
    mkdirSync(kanbanDir, { recursive: true });
    const dbPath = join(kanbanDir, "board.db");

    // Simuliert ein liegen gebliebenes v2-Board, ohne echtes v1->v2->v3 zu durchlaufen
    const staleDb = new Database(dbPath);
    staleDb.run("CREATE TABLE schema_version (version INTEGER NOT NULL)");
    staleDb.run("INSERT INTO schema_version (version) VALUES (2)");
    staleDb.close();

    expect(() => openDb(dbPath)).toThrow(/kanban migrate/);
  });

  test("openDb-Fehlermeldung bei veralteter Schema-Version nennt Pfad und Versionen", () => {
    const dir = tmpDir();
    const kanbanDir = join(dir, ".kanban");
    mkdirSync(kanbanDir, { recursive: true });
    const dbPath = join(kanbanDir, "board.db");

    const staleDb = new Database(dbPath);
    staleDb.run("CREATE TABLE schema_version (version INTEGER NOT NULL)");
    staleDb.run("INSERT INTO schema_version (version) VALUES (2)");
    staleDb.close();

    expect(() => openDb(dbPath)).toThrow(dbPath);
  });

  test("busy_timeout wird pro Connection gesetzt", () => {
    const dir = tmpDir();
    initBoard(dir, "Test");
    const db = openDb(getBoardPaths(dir).dbPath);
    const result = db.query("PRAGMA busy_timeout").get() as { timeout: number };
    db.close();

    expect(result.timeout).toBe(5000);
  });

  test("WAL ist aktiv nach openDb", () => {
    const dir = tmpDir();
    initBoard(dir, "Test");
    const db = openDb(getBoardPaths(dir).dbPath);
    const result = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
    db.close();

    expect(result.journal_mode).toBe("wal");
  });

  test("foreign_keys ist aktiv nach openDb", () => {
    const dir = tmpDir();
    initBoard(dir, "Test");
    const db = openDb(getBoardPaths(dir).dbPath);
    const result = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
    db.close();

    expect(result.foreign_keys).toBe(1);
  });

  test("WAL wird nicht unnoetig neu gesetzt wenn bereits aktiv", () => {
    const dir = tmpDir();
    initBoard(dir, "Test");
    const dbPath = getBoardPaths(dir).dbPath;

    // Erster Aufruf — WAL wird gesetzt
    const db1 = openDb(dbPath);
    const mode1 = db1.query("PRAGMA journal_mode").get() as { journal_mode: string };
    db1.close();
    expect(mode1.journal_mode).toBe("wal");

    // Zweiter Aufruf — WAL ist bereits aktiv, kein Fehler
    const db2 = openDb(dbPath);
    const mode2 = db2.query("PRAGMA journal_mode").get() as { journal_mode: string };
    db2.close();
    expect(mode2.journal_mode).toBe("wal");
  });
});
