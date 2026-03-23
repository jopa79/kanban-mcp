// Tests fuer withContext — DB oeffnen, Aktion ausfuehren, DB garantiert schliessen
import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initBoard, openDb, getBoardPaths } from "../src/core/db.ts";
import { withContext } from "../src/mcp/mcp-context.ts";

describe("withContext", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("liefert Ergebnis der Action", () => {
    dir = mkdtempSync(join(tmpdir(), "kanban-ctx-"));
    initBoard(dir, "Test Board");

    const result = withContext(dir, (ctx) => ctx.taskService.listTasks({}));
    expect(Array.isArray(result)).toBe(true);
  });

  test("schliesst DB nach Ausfuehrung", () => {
    dir = mkdtempSync(join(tmpdir(), "kanban-ctx-"));
    initBoard(dir, "Test Board");

    // withContext ausfuehren — DB sollte danach geschlossen sein
    withContext(dir, (ctx) => ctx.taskService.listTasks({}));

    // Zweite DB-Connection muss moeglich sein (kein Lock)
    const paths = getBoardPaths(dir);
    const db2 = openDb(paths.dbPath);
    expect(db2).toBeDefined();
    db2.close();
  });

  test("schliesst DB auch bei Exception", () => {
    dir = mkdtempSync(join(tmpdir(), "kanban-ctx-"));
    initBoard(dir, "Test Board");

    // Exception wird durchgeworfen
    expect(() =>
      withContext(dir, () => {
        throw new Error("Absichtlicher Fehler");
      })
    ).toThrow("Absichtlicher Fehler");

    // DB muss trotzdem geschlossen sein — neue Connection moeglich
    const paths = getBoardPaths(dir);
    const db2 = openDb(paths.dbPath);
    expect(db2).toBeDefined();
    db2.close();
  });

  test("wirft Fehler wenn kein Board existiert", () => {
    dir = mkdtempSync(join(tmpdir(), "kanban-ctx-"));

    expect(() =>
      withContext(dir, (ctx) => ctx.taskService.listTasks({}))
    ).toThrow("Kein Board gefunden");
  });

  test("liefert alle Services", () => {
    dir = mkdtempSync(join(tmpdir(), "kanban-ctx-"));
    initBoard(dir, "Test Board");

    withContext(dir, (ctx) => {
      expect(ctx.boardService).toBeDefined();
      expect(ctx.taskService).toBeDefined();
      expect(ctx.notesService).toBeDefined();
      expect(ctx.config).toBeDefined();
    });
  });
});
