// Tests fuer priority/dueDate (P2-1): Setzen, Validierung, Sortierung,
// isOverdue-Ableitung. Siehe Kanban-Task b6KKR3j7pu-N, GitHub #25, Plan 4.
import { test, expect, describe, afterEach } from "bun:test";
import { createTestBoard, type TestContext } from "./helpers.ts";

// Feste Referenzdaten statt "gestern"/"heute" zur Laufzeit -- ein Test darf
// nicht an Mitternacht flackern. 2026-07-15 als fixer "heute"-Anker; alle
// anderen Daten werden relativ dazu gebildet.
const YESTERDAY = "2026-07-14";
const TODAY = "2026-07-15";
const TOMORROW = "2026-07-16";

describe("Task-Metadaten (priority/dueDate)", () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  describe("Setzen, Lesen, Aendern, Zuruecksetzen", () => {
    test("addTask setzt priority und dueDate, getTask liest sie zurueck", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X", priority: "high", dueDate: "2026-08-01" });
      expect(task.priority).toBe("high");
      expect(task.dueDate).toBe("2026-08-01");

      const reloaded = ctx.taskService.getTask(task.id)!;
      expect(reloaded.priority).toBe("high");
      expect(reloaded.dueDate).toBe("2026-08-01");
    });

    test("addTask ohne priority/dueDate -> beide null", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X" });
      expect(task.priority).toBeNull();
      expect(task.dueDate).toBeNull();
    });

    test("updateTask aendert priority und dueDate", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X", priority: "low" });
      const updated = ctx.taskService.updateTask(task.id, { priority: "high", dueDate: "2026-09-01" });
      expect(updated.priority).toBe("high");
      expect(updated.dueDate).toBe("2026-09-01");
    });

    test("updateTask mit priority: null setzt die Prioritaet zurueck", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X", priority: "high", dueDate: "2026-08-01" });
      const updated = ctx.taskService.updateTask(task.id, { priority: null, dueDate: null });
      expect(updated.priority).toBeNull();
      expect(updated.dueDate).toBeNull();
    });

    test("updateTask ohne priority/dueDate laesst bestehende Werte unberuehrt", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X", priority: "medium", dueDate: "2026-08-01" });
      const updated = ctx.taskService.updateTask(task.id, { title: "Neuer Titel" });
      expect(updated.priority).toBe("medium");
      expect(updated.dueDate).toBe("2026-08-01");
    });
  });

  describe("Validierung: priority", () => {
    test("ungueltige Prioritaet wirft Fehler, der die gueltigen Werte aufzaehlt", () => {
      ctx = createTestBoard();
      expect(() => ctx.taskService.addTask({ title: "X", priority: "urgent" })).toThrow(/high.*medium.*low/s);
    });

    test("ungueltige Prioritaet bei updateTask wirft ebenfalls", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X" });
      expect(() => ctx.taskService.updateTask(task.id, { priority: "urgent" })).toThrow(/high, medium, low/);
    });
  });

  describe("Validierung: dueDate", () => {
    test("2026-02-31 (Tag existiert im Februar nicht) -> Fehler", () => {
      ctx = createTestBoard();
      expect(() => ctx.taskService.addTask({ title: "X", dueDate: "2026-02-31" })).toThrow();
    });

    test("2026-13-01 (Monat 13 existiert nicht) -> Fehler", () => {
      ctx = createTestBoard();
      expect(() => ctx.taskService.addTask({ title: "X", dueDate: "2026-13-01" })).toThrow();
    });

    test("01.03.2026 (falsches Format) -> Fehler", () => {
      ctx = createTestBoard();
      expect(() => ctx.taskService.addTask({ title: "X", dueDate: "01.03.2026" })).toThrow();
    });

    // Hinweis: 2026 ist KEIN Schaltjahr (2026 / 4 = 506,5) -- die "2026-02-29"
    // aus der urspruenglichen Notiz waere selbst ungueltig. 2024 und 2028
    // sind echte Schaltjahre; die Absicht der Notiz (ein echter 29. Februar
    // muss gueltig sein) wird hier mit einem tatsaechlich gueltigen Jahr
    // geprueft -- siehe Bericht an team-lead.
    test("2024-02-29 (echtes Schaltjahr) -> gueltig", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X", dueDate: "2024-02-29" });
      expect(task.dueDate).toBe("2024-02-29");
    });

    test("2026-02-29 (2026 ist KEIN Schaltjahr) -> Fehler", () => {
      ctx = createTestBoard();
      expect(() => ctx.taskService.addTask({ title: "X", dueDate: "2026-02-29" })).toThrow();
    });

    test("vergangene Faelligkeit ist erlaubt", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X", dueDate: "2020-01-01" });
      expect(task.dueDate).toBe("2020-01-01");
    });
  });

  describe("Sortierung", () => {
    test("sort: 'priority' -> high vor medium vor low vor null, danach Position/Erstellung", () => {
      ctx = createTestBoard();
      ctx.taskService.addTask({ title: "Ohne Prioritaet" });
      ctx.taskService.addTask({ title: "Low", priority: "low" });
      ctx.taskService.addTask({ title: "High", priority: "high" });
      ctx.taskService.addTask({ title: "Medium", priority: "medium" });

      const sorted = ctx.taskService.listTasks({ sort: "priority" });
      expect(sorted.map((t) => t.title)).toEqual(["High", "Medium", "Low", "Ohne Prioritaet"]);
    });

    test("sort: 'due' -> frueheste Faelligkeit zuerst, ohne Datum zuletzt", () => {
      ctx = createTestBoard();
      ctx.taskService.addTask({ title: "Ohne Datum" });
      ctx.taskService.addTask({ title: "Spaet", dueDate: "2026-12-01" });
      ctx.taskService.addTask({ title: "Frueh", dueDate: "2026-01-01" });

      const sorted = ctx.taskService.listTasks({ sort: "due" });
      expect(sorted.map((t) => t.title)).toEqual(["Frueh", "Spaet", "Ohne Datum"]);
    });

    test("ohne sort-Parameter bleibt die Default-Sortierung (position, created_at) erhalten", () => {
      ctx = createTestBoard();
      const a = ctx.taskService.addTask({ title: "A", priority: "low" });
      ctx.taskService.addTask({ title: "B", priority: "high" });
      // 'A' zuerst angelegt (kleinere position) bleibt trotz niedrigerer
      // Prioritaet vorn, wenn kein sort angegeben ist -- sonst zerreisst es
      // die manuelle TUI-Reihenfolge.
      const unsorted = ctx.taskService.listTasks();
      expect(unsorted[0]!.id).toBe(a.id);
    });
  });

  describe("Filter: priority", () => {
    test("filtert nach priority", () => {
      ctx = createTestBoard();
      ctx.taskService.addTask({ title: "A", priority: "high" });
      ctx.taskService.addTask({ title: "B", priority: "low" });
      const result = ctx.taskService.listTasks({ priority: "high" });
      expect(result).toHaveLength(1);
      expect(result[0]!.title).toBe("A");
    });
  });

  describe("isOverdue-Ableitung", () => {
    test("Faelligkeit gestern -> isOverdue true", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X", dueDate: YESTERDAY });
      expect(ctx.taskService.isOverdue(ctx.taskService.getTask(task.id)!, TODAY)).toBe(true);
    });

    test("Faelligkeit heute -> isOverdue false (heute faellig ist nicht ueberfaellig)", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X", dueDate: TODAY });
      expect(ctx.taskService.isOverdue(ctx.taskService.getTask(task.id)!, TODAY)).toBe(false);
    });

    test("Faelligkeit morgen -> isOverdue false", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X", dueDate: TOMORROW });
      expect(ctx.taskService.isOverdue(ctx.taskService.getTask(task.id)!, TODAY)).toBe(false);
    });

    test("keine Faelligkeit -> isOverdue false", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X" });
      expect(ctx.taskService.isOverdue(ctx.taskService.getTask(task.id)!, TODAY)).toBe(false);
    });

    test("Faelligkeit gestern, aber Task in der Terminal-Spalte (Done) -> isOverdue false", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X", dueDate: YESTERDAY });
      ctx.taskService.moveTask(task.id, "done", { override: true });
      expect(ctx.taskService.isOverdue(ctx.taskService.getTask(task.id)!, TODAY)).toBe(false);
    });

    test("Faelligkeit gestern, aber Task archiviert -> isOverdue false", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X", dueDate: YESTERDAY });
      ctx.taskService.moveTask(task.id, "done", { override: true });
      ctx.taskService.archiveTask(task.id);
      const archived = ctx.taskService.getTask(task.id)!;
      expect(archived.archived).toBe(true);
      expect(ctx.taskService.isOverdue(archived, TODAY)).toBe(false);
    });

    test("getTask/listTasks setzen isOverdue automatisch (ohne expliziten today-Parameter)", () => {
      ctx = createTestBoard();
      const farPast = "2000-01-01";
      const task = ctx.taskService.addTask({ title: "X", dueDate: farPast });
      expect(ctx.taskService.getTask(task.id)!.isOverdue).toBe(true);
      expect(ctx.taskService.listTasks()[0]!.isOverdue).toBe(true);
    });

    test("filter overdue: true liefert nur ueberfaellige Tasks", () => {
      ctx = createTestBoard();
      ctx.taskService.addTask({ title: "Ueberfaellig", dueDate: "2000-01-01" });
      ctx.taskService.addTask({ title: "Zukunft", dueDate: "2999-01-01" });
      ctx.taskService.addTask({ title: "Ohne Datum" });

      const overdue = ctx.taskService.listTasks({ overdue: true });
      expect(overdue.map((t) => t.title)).toEqual(["Ueberfaellig"]);
    });
  });

  describe("Sync fasst priority nicht an", () => {
    test("ein Task mit gesetzter Prioritaet behaelt sie nach einem Sync-Lauf", async () => {
      ctx = createTestBoard();
      const { syncTodos } = await import("../src/core/sync-service.ts");
      const task = ctx.taskService.addTask({ title: "Wichtiger Task", priority: "high" });

      syncTodos(ctx.db, ctx.taskService, ctx.boardService, [
        { content: "Wichtiger Task", status: "in_progress", activeForm: "" },
      ]);

      expect(ctx.taskService.getTask(task.id)!.priority).toBe("high");
    });
  });
});
