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

  // P1-4 (ADR 0002): der Ablehnungstext darf force nicht mehr bewerben --
  // ein Ablehnungstext, der seinen eigenen Umgehungsweg mitliefert, ist keine
  // Ablehnung. Deckt beide Ablehnungspfade ab (exaktes und aehnliches Duplikat).
  test("rejectionReason erwaehnt 'force' nirgends, weder bei exaktem noch bei aehnlichem Duplikat", () => {
    ctx = createTestBoard();
    ctx.taskService.addTask({ title: "Login Feature bauen" });

    const exact = ctx.taskService.addTaskChecked({ title: "Login Feature bauen" });
    expect(exact.rejectionReason?.toLowerCase()).not.toContain("force");

    const similar = ctx.taskService.addTaskChecked({ title: "Login Feature implementieren" });
    expect(similar.rejectionReason?.toLowerCase()).not.toContain("force");
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
