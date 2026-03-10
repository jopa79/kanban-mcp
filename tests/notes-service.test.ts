// Tests fuer NotesService und Notes-Integration im TaskService
import { test, expect, describe, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createTestBoard, type TestContext } from "./helpers.ts";

describe("NotesService", () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  describe("save + load", () => {
    test("speichert und laedt Notes", () => {
      ctx = createTestBoard();
      ctx.notesService.save("test-id", "# Hallo\n\nInhalt");
      const content = ctx.notesService.load("test-id");
      expect(content).toBe("# Hallo\n\nInhalt");
    });

    test("erstellt notes/ Ordner automatisch", () => {
      ctx = createTestBoard();
      const notesDir = join(ctx.dir, ".kanban", "notes");
      expect(existsSync(notesDir)).toBe(false);
      ctx.notesService.save("abc", "test");
      expect(existsSync(notesDir)).toBe(true);
    });

    test("load gibt null wenn keine Notes vorhanden", () => {
      ctx = createTestBoard();
      expect(ctx.notesService.load("nope")).toBeNull();
    });
  });

  describe("exists", () => {
    test("gibt false wenn keine Notes vorhanden", () => {
      ctx = createTestBoard();
      expect(ctx.notesService.exists("nope")).toBe(false);
    });

    test("gibt true wenn Notes existieren", () => {
      ctx = createTestBoard();
      ctx.notesService.save("test-id", "inhalt");
      expect(ctx.notesService.exists("test-id")).toBe(true);
    });
  });

  describe("delete", () => {
    test("loescht vorhandene Notes", () => {
      ctx = createTestBoard();
      ctx.notesService.save("test-id", "inhalt");
      ctx.notesService.delete("test-id");
      expect(ctx.notesService.exists("test-id")).toBe(false);
    });

    test("wirft keinen Fehler bei nicht-existierenden Notes", () => {
      ctx = createTestBoard();
      expect(() => ctx.notesService.delete("nope")).not.toThrow();
    });
  });

  describe("getPath", () => {
    test("gibt korrekten Pfad zurueck", () => {
      ctx = createTestBoard();
      const path = ctx.notesService.getPath("abc123");
      expect(path).toContain(".kanban/notes/abc123.md");
    });
  });
});

describe("TaskService + Notes Integration", () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  test("addTask speichert Notes wenn mitgeliefert", () => {
    ctx = createTestBoard();
    const task = ctx.taskService.addTask({
      title: "Task mit Notes",
      notes: "# Plan\n- Schritt 1",
    });
    expect(ctx.notesService.exists(task.id)).toBe(true);
    expect(ctx.notesService.load(task.id)).toBe("# Plan\n- Schritt 1");
  });

  test("addTask ohne Notes erstellt keine Datei", () => {
    ctx = createTestBoard();
    const task = ctx.taskService.addTask({ title: "Ohne Notes" });
    expect(ctx.notesService.exists(task.id)).toBe(false);
  });

  test("getTask liefert Notes-Inhalt", () => {
    ctx = createTestBoard();
    const task = ctx.taskService.addTask({
      title: "X",
      notes: "Meine Notizen",
    });
    const fetched = ctx.taskService.getTask(task.id);
    expect(fetched!.notes).toBe("Meine Notizen");
    expect(fetched!.hasNotes).toBe(true);
  });

  test("getTask ohne Notes hat hasNotes=false", () => {
    ctx = createTestBoard();
    const task = ctx.taskService.addTask({ title: "X" });
    const fetched = ctx.taskService.getTask(task.id);
    expect(fetched!.notes).toBeNull();
    expect(fetched!.hasNotes).toBe(false);
  });

  test("listTasks liefert hasNotes Flag aber keinen Inhalt", () => {
    ctx = createTestBoard();
    ctx.taskService.addTask({ title: "Mit Notes", notes: "inhalt" });
    ctx.taskService.addTask({ title: "Ohne Notes" });
    const tasks = ctx.taskService.listTasks();
    const mitNotes = tasks.find(t => t.title === "Mit Notes")!;
    const ohneNotes = tasks.find(t => t.title === "Ohne Notes")!;
    expect(mitNotes.hasNotes).toBe(true);
    expect(mitNotes.notes).toBeUndefined();
    expect(ohneNotes.hasNotes).toBe(false);
  });

  test("deleteTask loescht auch Notes", () => {
    ctx = createTestBoard();
    const task = ctx.taskService.addTask({
      title: "Bye",
      notes: "wird geloescht",
    });
    ctx.taskService.deleteTask(task.id);
    expect(ctx.notesService.exists(task.id)).toBe(false);
  });

  test("updateTask mit notes speichert Notes", () => {
    ctx = createTestBoard();
    const task = ctx.taskService.addTask({ title: "X" });
    ctx.taskService.updateTask(task.id, { notes: "Neue Notizen" });
    expect(ctx.notesService.load(task.id)).toBe("Neue Notizen");
  });

  test("updateTask mit notes=null loescht Notes", () => {
    ctx = createTestBoard();
    const task = ctx.taskService.addTask({
      title: "X",
      notes: "wird geloescht",
    });
    ctx.taskService.updateTask(task.id, { notes: null });
    expect(ctx.notesService.exists(task.id)).toBe(false);
  });
});
