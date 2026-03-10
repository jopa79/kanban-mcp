// Tests fuer ArchiveService
import { test, expect, describe, afterEach } from "bun:test";
import { createTestBoard, type TestContext } from "./helpers.ts";

describe("ArchiveService", () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  describe("archiveTasks", () => {
    test("archiviert Tasks aus Done-Spalte", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "Done Task", columnId: "done" });
      const result = ctx.taskService.archiveTasks();
      expect(result.archivedCount).toBe(1);
      expect(result.tasks[0]!.id).toBe(task.id);
    });

    test("archiviert nicht aus anderen Spalten (default)", () => {
      ctx = createTestBoard();
      ctx.taskService.addTask({ title: "Todo Task" });
      const result = ctx.taskService.archiveTasks();
      expect(result.archivedCount).toBe(0);
    });

    test("archiviert aus bestimmter Spalte", () => {
      ctx = createTestBoard();
      ctx.taskService.addTask({ title: "Review Task", columnId: "review" });
      const result = ctx.taskService.archiveTasks({ columnId: "review" });
      expect(result.archivedCount).toBe(1);
    });

    test("dryRun veraendert nichts", () => {
      ctx = createTestBoard();
      ctx.taskService.addTask({ title: "Done Task", columnId: "done" });
      const dryResult = ctx.taskService.archiveTasks({ dryRun: true });
      expect(dryResult.archivedCount).toBe(1);
      // Task ist noch da (nicht archiviert)
      const tasks = ctx.taskService.listTasks();
      expect(tasks).toHaveLength(1);
    });

    test("archivierte Tasks erscheinen nicht in listTasks", () => {
      ctx = createTestBoard();
      ctx.taskService.addTask({ title: "Done Task", columnId: "done" });
      ctx.taskService.archiveTasks();
      expect(ctx.taskService.listTasks()).toHaveLength(0);
    });
  });

  describe("restoreTask", () => {
    test("stellt archivierten Task wieder her", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "Restore Me", columnId: "done" });
      ctx.taskService.archiveTasks();
      const restored = ctx.taskService.restoreTask(task.id);
      expect(restored.archived).toBe(false);
      expect(restored.columnId).toBe("todo"); // Default Ziel-Spalte
    });

    test("stellt in bestimmte Spalte wieder her", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X", columnId: "done" });
      ctx.taskService.archiveTasks();
      const restored = ctx.taskService.restoreTask(task.id, "in-progress");
      expect(restored.columnId).toBe("in-progress");
    });

    test("wirft Fehler wenn Task nicht archiviert", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "Active" });
      expect(() => ctx.taskService.restoreTask(task.id)).toThrow("nicht archiviert");
    });

    test("wirft Fehler bei unbekannter Ziel-Spalte", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X", columnId: "done" });
      ctx.taskService.archiveTasks();
      expect(() => ctx.taskService.restoreTask(task.id, "nope")).toThrow("existiert nicht");
    });
  });

  describe("purgeArchive", () => {
    test("loescht archivierte Tasks permanent", () => {
      ctx = createTestBoard();
      ctx.taskService.addTask({ title: "X", columnId: "done" });
      ctx.taskService.archiveTasks();
      const result = ctx.taskService.purgeArchive();
      expect(result.deletedCount).toBe(1);
      // Wirklich geloescht, auch mit includeArchived
      const all = ctx.taskService.listTasks({ includeArchived: true });
      expect(all).toHaveLength(0);
    });

    test("dryRun loescht nichts", () => {
      ctx = createTestBoard();
      ctx.taskService.addTask({ title: "X", columnId: "done" });
      ctx.taskService.archiveTasks();
      const dryResult = ctx.taskService.purgeArchive({ dryRun: true });
      expect(dryResult.deletedCount).toBe(1);
      // Immer noch vorhanden
      const stats = ctx.taskService.getArchiveStats();
      expect(stats.total).toBe(1);
    });
  });

  describe("getArchiveStats", () => {
    test("zaehlt archivierte Tasks nach Spalte", () => {
      ctx = createTestBoard();
      ctx.taskService.addTask({ title: "A", columnId: "done" });
      ctx.taskService.addTask({ title: "B", columnId: "done" });
      ctx.taskService.archiveTasks();
      const stats = ctx.taskService.getArchiveStats();
      expect(stats.total).toBe(2);
      expect(stats.byColumn["done"]).toBe(2);
    });

    test("gibt 0 wenn nichts archiviert", () => {
      ctx = createTestBoard();
      const stats = ctx.taskService.getArchiveStats();
      expect(stats.total).toBe(0);
    });
  });
});
