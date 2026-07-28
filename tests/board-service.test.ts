// Tests fuer BoardService
import { test, expect, describe, afterEach } from "bun:test";
import { writeFileSync } from "node:fs";
import { createTestBoard, type TestContext } from "./helpers.ts";
import { BoardService } from "../src/core/board-service.ts";
import { getBoardPaths, loadBoardConfig } from "../src/core/db.ts";

describe("BoardService", () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  test("getColumns liefert 5 Default-Spalten", () => {
    ctx = createTestBoard();
    const cols = ctx.boardService.getColumns();
    expect(cols).toHaveLength(5);
    expect(cols[0]!.id).toBe("backlog");
    expect(cols[4]!.id).toBe("done");
  });

  test("getColumns sind nach Position sortiert", () => {
    ctx = createTestBoard();
    const cols = ctx.boardService.getColumns();
    for (let i = 1; i < cols.length; i++) {
      expect(cols[i]!.position).toBeGreaterThan(cols[i - 1]!.position);
    }
  });

  test("getColumn findet existierende Spalte", () => {
    ctx = createTestBoard();
    const col = ctx.boardService.getColumn("todo");
    expect(col).not.toBeNull();
    expect(col!.name).toBe("Todo");
  });

  test("getColumn gibt null fuer unbekannte Spalte", () => {
    ctx = createTestBoard();
    const col = ctx.boardService.getColumn("nonexistent");
    expect(col).toBeNull();
  });

  test("getTerminalColumn findet Done-Spalte", () => {
    ctx = createTestBoard();
    const terminal = ctx.boardService.getTerminalColumn();
    expect(terminal).not.toBeNull();
    expect(terminal!.id).toBe("done");
    expect(terminal!.isTerminal).toBe(true);
  });

  test("getColumnTaskCount ist initial 0", () => {
    ctx = createTestBoard();
    expect(ctx.boardService.getColumnTaskCount("todo")).toBe(0);
  });

  test("getColumnTaskCount zaehlt Tasks korrekt", () => {
    ctx = createTestBoard();
    ctx.taskService.addTask({ title: "Task 1" });
    ctx.taskService.addTask({ title: "Task 2" });
    expect(ctx.boardService.getColumnTaskCount("todo")).toBe(2);
  });

  test("In-Progress hat WIP-Limit 3", () => {
    ctx = createTestBoard();
    const col = ctx.boardService.getColumn("in-progress");
    expect(col!.wipLimit).toBe(3);
  });

  // P0-2: Spalten kommen jetzt aus config.json, position wird aus dem Array-Index
  // abgeleitet (ADR 0001). Kein .sort() — die Datei-Reihenfolge ist die Ordnung.
  test("getColumns folgt der Reihenfolge aus config.json, position folgt dem Index", () => {
    ctx = createTestBoard();
    const paths = getBoardPaths(ctx.dir);
    const config = loadBoardConfig(paths.configPath);

    // Reihenfolge umkehren und zurueckschreiben — simuliert manuelles Umsortieren
    const reordered = { ...config, columns: [...config.columns].reverse() };
    writeFileSync(paths.configPath, JSON.stringify(reordered, null, 2));

    const reloadedConfig = loadBoardConfig(paths.configPath);
    const boardService = new BoardService(ctx.db, reloadedConfig);
    const cols = boardService.getColumns();

    expect(cols.map((c) => c.id)).toEqual(["done", "review", "in-progress", "todo", "backlog"]);
    expect(cols[0]!.position).toBe(0);
    expect(cols[4]!.position).toBe(4);
  });

  test("getOrphanColumnIds ist leer wenn alle Tasks bekannte Spalten haben", () => {
    ctx = createTestBoard();
    ctx.taskService.addTask({ title: "Task 1" });
    expect(ctx.boardService.getOrphanColumnIds()).toEqual([]);
  });

  test("getOrphanColumnIds findet Tasks in Spalten, die in config.json fehlen", () => {
    ctx = createTestBoard();
    const task = ctx.taskService.addTask({ title: "Task 1" });
    // Direkter SQL-Zugriff simuliert eine Spalte, die es in der Config nicht (mehr)
    // gibt (z.B. nach manuellem Config-Edit oder Import) — moveTask() selbst wuerde
    // das ueber getColumn() ablehnen.
    ctx.db.run("UPDATE tasks SET column_id = 'geloeschte-spalte' WHERE id = ?", [task.id]);

    expect(ctx.boardService.getOrphanColumnIds()).toEqual(["geloeschte-spalte"]);
  });
});
