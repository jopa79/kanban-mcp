// Tests fuer BoardService
import { test, expect, describe, afterEach } from "bun:test";
import { createTestBoard, type TestContext } from "./helpers.ts";

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
});
