// Tests fuer TaskService — CRUD, Verschieben, Duplikat-Erkennung
import { test, expect, describe, afterEach } from "bun:test";
import { createTestBoard, type TestContext } from "./helpers.ts";

describe("TaskService", () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  describe("addTask", () => {
    test("erstellt Task mit korrekten Defaults", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "Test Task" });
      expect(task.title).toBe("Test Task");
      expect(task.columnId).toBe("todo");
      expect(task.createdBy).toBe("user");
      expect(task.archived).toBe(false);
      expect(task.version).toBe(1);
      expect(task.id).toHaveLength(12);
    });

    test("respektiert optionale Felder", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({
        title: "Task",
        description: "Beschreibung",
        columnId: "in-progress",
        createdBy: "claude",
        assignedTo: "jopa",
        labels: ["bug", "urgent"],
      });
      expect(task.description).toBe("Beschreibung");
      expect(task.columnId).toBe("in-progress");
      expect(task.createdBy).toBe("claude");
      expect(task.assignedTo).toBe("jopa");
      expect(task.labels).toEqual(["bug", "urgent"]);
    });

    test("wirft Fehler bei ungueltiger Spalte", () => {
      ctx = createTestBoard();
      expect(() => ctx.taskService.addTask({ title: "X", columnId: "nope" })).toThrow("existiert nicht");
    });
  });

  describe("getTask", () => {
    test("findet Task per vollstaendiger ID", () => {
      ctx = createTestBoard();
      const created = ctx.taskService.addTask({ title: "Find Me" });
      const found = ctx.taskService.getTask(created.id);
      expect(found).not.toBeNull();
      expect(found!.title).toBe("Find Me");
    });

    test("findet Task per Prefix", () => {
      ctx = createTestBoard();
      const created = ctx.taskService.addTask({ title: "Prefix Task" });
      const found = ctx.taskService.getTask(created.id.slice(0, 4));
      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    test("gibt null fuer unbekannte ID", () => {
      ctx = createTestBoard();
      expect(ctx.taskService.getTask("doesnotexist")).toBeNull();
    });
  });

  describe("listTasks", () => {
    test("listet alle Tasks", () => {
      ctx = createTestBoard();
      ctx.taskService.addTask({ title: "A" });
      ctx.taskService.addTask({ title: "B" });
      expect(ctx.taskService.listTasks()).toHaveLength(2);
    });

    test("filtert nach Spalte", () => {
      ctx = createTestBoard();
      ctx.taskService.addTask({ title: "A", columnId: "todo" });
      ctx.taskService.addTask({ title: "B", columnId: "in-progress" });
      const todos = ctx.taskService.listTasks({ columnId: "todo" });
      expect(todos).toHaveLength(1);
      expect(todos[0]!.title).toBe("A");
    });

    test("filtert nach Assignee", () => {
      ctx = createTestBoard();
      ctx.taskService.addTask({ title: "A", assignedTo: "alice" });
      ctx.taskService.addTask({ title: "B", assignedTo: "bob" });
      const aliceTasks = ctx.taskService.listTasks({ assignedTo: "alice" });
      expect(aliceTasks).toHaveLength(1);
    });

    test("schliesst archivierte Tasks standardmaessig aus", () => {
      ctx = createTestBoard();
      ctx.taskService.addTask({ title: "Active", columnId: "done" });
      ctx.taskService.archiveTasks();
      expect(ctx.taskService.listTasks()).toHaveLength(0);
    });
  });

  describe("moveTask", () => {
    test("verschiebt Task in andere Spalte", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "Move Me" });
      const moved = ctx.taskService.moveTask(task.id, "in-progress");
      expect(moved.columnId).toBe("in-progress");
      expect(moved.version).toBe(2);
    });

    test("wirft Fehler bei ungueltiger Ziel-Spalte", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X" });
      expect(() => ctx.taskService.moveTask(task.id, "invalid")).toThrow("existiert nicht");
    });

    test("wirft Fehler bei unbekanntem Task", () => {
      ctx = createTestBoard();
      expect(() => ctx.taskService.moveTask("nope", "todo")).toThrow("nicht gefunden");
    });
  });

  describe("updateTask", () => {
    test("aendert Titel", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "Alt" });
      const updated = ctx.taskService.updateTask(task.id, { title: "Neu" });
      expect(updated.title).toBe("Neu");
      expect(updated.version).toBe(2);
    });

    test("aendert Labels", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X" });
      const updated = ctx.taskService.updateTask(task.id, { labels: ["a", "b"] });
      expect(updated.labels).toEqual(["a", "b"]);
    });

    test("setzt Assignee auf null", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X", assignedTo: "alice" });
      const updated = ctx.taskService.updateTask(task.id, { assignedTo: null });
      expect(updated.assignedTo).toBeNull();
    });

    test("ohne Aenderungen bleibt Version gleich", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X" });
      const same = ctx.taskService.updateTask(task.id, {});
      expect(same.version).toBe(1);
    });
  });

  describe("deleteTask", () => {
    test("loescht Task", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "Bye" });
      ctx.taskService.deleteTask(task.id);
      expect(ctx.taskService.getTask(task.id)).toBeNull();
    });

    test("wirft Fehler bei unbekanntem Task", () => {
      ctx = createTestBoard();
      expect(() => ctx.taskService.deleteTask("nope")).toThrow("nicht gefunden");
    });
  });

  describe("completeTask", () => {
    test("verschiebt Task in Done-Spalte", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "Finish" });
      const done = ctx.taskService.completeTask(task.id);
      expect(done.columnId).toBe("done");
    });
  });

});
