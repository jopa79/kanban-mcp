// Tests fuer Datenbank-Setup und Board-Initialisierung
import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initBoard, boardExists, getBoardPaths, openDb } from "../src/core/db.ts";

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

  test("DB hat korrekte Tabellen nach initBoard", () => {
    const dir = tmpDir();
    initBoard(dir, "Test");
    const db = openDb(getBoardPaths(dir).dbPath);
    const tables = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as Array<{ name: string }>;
    db.close();

    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain("columns");
    expect(tableNames).toContain("tasks");
    expect(tableNames).toContain("dependencies");
  });

  test("DB hat Default-Spalten nach initBoard", () => {
    const dir = tmpDir();
    initBoard(dir, "Test");
    const db = openDb(getBoardPaths(dir).dbPath);
    const cols = db.query("SELECT id FROM columns ORDER BY position").all() as Array<{ id: string }>;
    db.close();

    expect(cols.map(c => c.id)).toEqual(["backlog", "todo", "in-progress", "review", "done"]);
  });
});
