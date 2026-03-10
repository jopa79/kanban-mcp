// Tests fuer addTaskChecked (Duplikat-Erkennung) und getStatus
import { test, expect, describe, afterEach } from "bun:test";
import { createTestBoard, type TestContext } from "./helpers.ts";

describe("addTaskChecked", () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  test("erstellt Task wenn kein Duplikat", () => {
    ctx = createTestBoard();
    const result = ctx.taskService.addTaskChecked({ title: "Unique Task" });
    expect(result.rejected).toBe(false);
    expect(result.task).not.toBeNull();
  });

  test("lehnt exaktes Duplikat ab", () => {
    ctx = createTestBoard();
    ctx.taskService.addTask({ title: "Login Feature" });
    const result = ctx.taskService.addTaskChecked({ title: "Login Feature" });
    expect(result.rejected).toBe(true);
    expect(result.task).toBeNull();
    expect(result.similarTasks).toHaveLength(1);
  });

  test("lehnt case-insensitives Duplikat ab", () => {
    ctx = createTestBoard();
    ctx.taskService.addTask({ title: "Login Feature" });
    const result = ctx.taskService.addTaskChecked({ title: "login feature" });
    expect(result.rejected).toBe(true);
  });

  test("lehnt aehnlichen Titel ab", () => {
    ctx = createTestBoard();
    ctx.taskService.addTask({ title: "Login Feature bauen" });
    const result = ctx.taskService.addTaskChecked({ title: "Login Feature implementieren" });
    expect(result.rejected).toBe(true);
  });

  test("force umgeht Duplikat-Check", () => {
    ctx = createTestBoard();
    ctx.taskService.addTask({ title: "Login Feature" });
    const result = ctx.taskService.addTaskChecked({ title: "Login Feature" }, { force: true });
    expect(result.rejected).toBe(false);
    expect(result.task).not.toBeNull();
  });

  test("rejectionReason enthaelt bestehende Task-Info", () => {
    ctx = createTestBoard();
    ctx.taskService.addTask({ title: "Login Feature" });
    const result = ctx.taskService.addTaskChecked({ title: "Login Feature" });
    expect(result.rejectionReason).toContain("Login Feature");
    expect(result.rejectionReason).toContain("existiert bereits");
  });
});

describe("getStatus", () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  test("zeigt alle Spalten mit korrekten Counts", () => {
    ctx = createTestBoard();
    ctx.taskService.addTask({ title: "A" });
    ctx.taskService.addTask({ title: "B" });
    const status = ctx.taskService.getStatus();
    expect(status.total).toBe(2);
    const todoCol = status.columns.find(c => c.columnId === "todo");
    expect(todoCol!.count).toBe(2);
  });

  test("leeres Board hat total 0", () => {
    ctx = createTestBoard();
    const status = ctx.taskService.getStatus();
    expect(status.total).toBe(0);
    expect(status.columns).toHaveLength(5);
  });
});
