// Tests fuer SyncService (P1-7) — Content-Matching, Transaktion, Reconcile,
// WIP-Log. Siehe Kanban-Task cSKUfYTt--Ma, GitHub #24, Plan Abschnitt 0.1/3.9.
import { test, expect, describe, afterEach } from "bun:test";
import { createTestBoard, type TestContext } from "./helpers.ts";
import { syncTodos, truncate, TITLE_TRUNCATE_LENGTH, type TodoItem } from "../src/core/sync-service.ts";
import { TransitionService } from "../src/core/transition-service.ts";

describe("syncTodos", () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  describe("Content-Matching", () => {
    test("exakter Titelvergleich findet bestehenden Task und bewegt ihn", () => {
      ctx = createTestBoard();
      const existing = ctx.taskService.addTask({ title: "Mein Task" });
      const todos: TodoItem[] = [{ content: "Mein Task", status: "in_progress", activeForm: "Arbeitet an Mein Task" }];

      const report = syncTodos(ctx.db, ctx.taskService, ctx.boardService, todos);

      expect(report.created).toBe(0);
      expect(report.moved).toBe(1);
      expect(report.skipped).toBe(0);
      expect(ctx.taskService.getTask(existing.id)!.columnId).toBe("in-progress");
    });

    test("Vergleich gegen die 200-Zeichen-Kuerzung findet bestehenden Task", () => {
      ctx = createTestBoard();
      const longContent = "A".repeat(250);
      const existing = ctx.taskService.addTask({ title: truncate(longContent, TITLE_TRUNCATE_LENGTH) });
      const todos: TodoItem[] = [{ content: longContent, status: "in_progress", activeForm: "" }];

      const report = syncTodos(ctx.db, ctx.taskService, ctx.boardService, todos);

      expect(report.moved).toBe(1);
      expect(report.created).toBe(0);
      expect(ctx.taskService.getTask(existing.id)!.columnId).toBe("in-progress");
    });

    test("kein Treffer -> neuer Task, Titel auf 200 Zeichen gekuerzt", () => {
      ctx = createTestBoard();
      const longContent = "B".repeat(250);
      const todos: TodoItem[] = [{ content: longContent, status: "pending", activeForm: "" }];

      const report = syncTodos(ctx.db, ctx.taskService, ctx.boardService, todos);

      expect(report.created).toBe(1);
      const task = ctx.taskService.listTasks()[0]!;
      expect(task.title).toBe(truncate(longContent, TITLE_TRUNCATE_LENGTH));
      expect(task.title.length).toBe(TITLE_TRUNCATE_LENGTH);
    });

    test("zwei gleichnamige Tasks im Board -> der aeltere gewinnt, deterministisch (nicht Listenreihenfolge)", () => {
      ctx = createTestBoard();
      const older = ctx.taskService.addTask({ title: "Duplikat" });
      const newer = ctx.taskService.addTask({ title: "Duplikat" });

      // Zeitstempel explizit auseinanderziehen -- unabhaengig von echter
      // Ausfuehrungsgeschwindigkeit.
      const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      ctx.db.run("UPDATE tasks SET created_at = ? WHERE id = ?", [tenMinAgo, older.id]);
      ctx.db.run("UPDATE tasks SET created_at = ? WHERE id = ?", [fiveMinAgo, newer.id]);

      // Listenreihenfolge (position) bewusst gegen die Erstellungsreihenfolge
      // drehen: newer bekommt die kleinere position als older.
      ctx.taskService.reorderTask(newer.id, "up");

      const todos: TodoItem[] = [{ content: "Duplikat", status: "in_progress", activeForm: "" }];
      const report = syncTodos(ctx.db, ctx.taskService, ctx.boardService, todos);

      expect(report.moved).toBe(1);
      expect(ctx.taskService.getTask(older.id)!.columnId).toBe("in-progress");
      expect(ctx.taskService.getTask(newer.id)!.columnId).toBe("todo"); // unberuehrt
    });

    test("archivierter Task mit passendem Titel wird nicht getroffen", () => {
      ctx = createTestBoard();
      const archived = ctx.taskService.addTask({ title: "Erledigt" });
      ctx.taskService.archiveTask(archived.id);

      const todos: TodoItem[] = [{ content: "Erledigt", status: "pending", activeForm: "" }];
      const report = syncTodos(ctx.db, ctx.taskService, ctx.boardService, todos);

      expect(report.created).toBe(1);
      expect(report.moved).toBe(0);
    });

    test("zwei gleichnamige Todos im selben Payload treffen nicht denselben bestehenden Task zweimal", () => {
      ctx = createTestBoard();
      ctx.taskService.addTask({ title: "Gleicher Titel" });
      const todos: TodoItem[] = [
        { content: "Gleicher Titel", status: "in_progress", activeForm: "" },
        { content: "Gleicher Titel", status: "in_progress", activeForm: "" },
      ];

      const report = syncTodos(ctx.db, ctx.taskService, ctx.boardService, todos);

      // Der erste Todo trifft den bestehenden Task, der zweite darf ihn NICHT
      // nochmal treffen -- sonst kollabieren zwei Todos auf einen Task.
      expect(report.moved).toBe(1);
      expect(report.created).toBe(1);
      const all = ctx.taskService.listTasks().filter((t) => t.title === "Gleicher Titel");
      expect(all).toHaveLength(2);
    });
  });

  describe("Reconcile", () => {
    test("bestehender Task, Todo wird 'completed' -> 3 Reconcile-Transitions in richtiger Reihenfolge", () => {
      ctx = createTestBoard();
      const transitions = new TransitionService(ctx.db, ctx.boardService);
      const existing = ctx.taskService.addTask({ title: "Mein Task" });
      const todos: TodoItem[] = [{ content: "Mein Task", status: "completed", activeForm: "" }];

      const report = syncTodos(ctx.db, ctx.taskService, ctx.boardService, todos);

      expect(report.moved).toBe(1);
      expect(ctx.taskService.getTask(existing.id)!.columnId).toBe("done");

      const history = transitions.history(existing.id);
      // 1 Entstehungs-Transition (addTask oben) + 3 Reconcile-Schritte
      expect(history).toHaveLength(4);
      const reconcileSteps = history.slice(1);
      expect(reconcileSteps.map((t) => t.toColumn)).toEqual(["in-progress", "review", "done"]);
      expect(reconcileSteps.every((t) => t.reason === "reconcile")).toBe(true);
      expect(reconcileSteps.every((t) => t.reportedBy === "sync")).toBe(true);
      expect(reconcileSteps.every((t) => t.wasOverride === false)).toBe(true);
    });

    test("neuer Todo mit status 'completed' erzeugt 4 Transitions insgesamt, Task landet in Done", () => {
      ctx = createTestBoard();
      const todos: TodoItem[] = [{ content: "Neuer Task", status: "completed", activeForm: "" }];

      const report = syncTodos(ctx.db, ctx.taskService, ctx.boardService, todos);

      expect(report.created).toBe(1);
      const task = ctx.taskService.listTasks().find((t) => t.title === "Neuer Task")!;
      expect(task.columnId).toBe("done");

      const transitions = new TransitionService(ctx.db, ctx.boardService);
      const history = transitions.history(task.id);
      expect(history).toHaveLength(4);
      expect(history[0]!.fromColumn).toBeNull();
      expect(history[0]!.toColumn).toBe("todo");
      expect(history[0]!.reportedBy).toBe("sync");
      expect(history.slice(1).map((t) => t.toColumn)).toEqual(["in-progress", "review", "done"]);
    });

    test("Reconcile rueckwaerts (done -> todo, falls ein Todo zurueckgesetzt wird) ist ein direkter Sprung", () => {
      ctx = createTestBoard();
      const transitions = new TransitionService(ctx.db, ctx.boardService);
      const existing = ctx.taskService.addTask({ title: "Zurueckgesetzt" });
      ctx.taskService.moveTask(existing.id, "done", { override: true });

      const todos: TodoItem[] = [{ content: "Zurueckgesetzt", status: "pending", activeForm: "" }];
      const report = syncTodos(ctx.db, ctx.taskService, ctx.boardService, todos);

      expect(report.moved).toBe(1);
      expect(ctx.taskService.getTask(existing.id)!.columnId).toBe("todo");

      const history = transitions.history(existing.id);
      const last = history[history.length - 1]!;
      expect(last.fromColumn).toBe("done");
      expect(last.toColumn).toBe("todo");
      expect(last.reason).toBe("reconcile");
    });
  });

  describe("WIP-Verstoesse", () => {
    test("WIP-Ueberschreitung wird geloggt (was_override, reason wip-exceeded (sync)), nicht abgelehnt", () => {
      ctx = createTestBoard();
      const transitions = new TransitionService(ctx.db, ctx.boardService);
      const a = ctx.taskService.addTask({ title: "A" });
      const b = ctx.taskService.addTask({ title: "B" });
      const c = ctx.taskService.addTask({ title: "C" });
      ctx.taskService.moveTask(a.id, "in-progress");
      ctx.taskService.moveTask(b.id, "in-progress");
      ctx.taskService.moveTask(c.id, "in-progress");

      const target = ctx.taskService.addTask({ title: "D" });
      const todos: TodoItem[] = [{ content: "D", status: "in_progress", activeForm: "" }];

      const report = syncTodos(ctx.db, ctx.taskService, ctx.boardService, todos);

      expect(report.moved).toBe(1);
      expect(report.wipOverrides).toBe(1);
      expect(ctx.taskService.getTask(target.id)!.columnId).toBe("in-progress");

      const history = transitions.history(target.id);
      const last = history[history.length - 1]!;
      expect(last.wasOverride).toBe(true);
      expect(last.reason).toBe("wip-exceeded (sync)");
      expect(last.reportedBy).toBe("sync");
    });
  });

  describe("Transaktion", () => {
    test("Fehler in der Mitte (blockierter Task kann nicht vorwaerts bewegt werden) -> kein Task geschrieben", () => {
      ctx = createTestBoard();
      const blocker = ctx.taskService.addTask({ title: "Blocker" }); // wird nie geloest
      ctx.taskService.addTask({ title: "Blockierter Task", dependsOn: [blocker.id] });
      const before = ctx.taskService.listTasks();

      const todos: TodoItem[] = [
        { content: "Ganz neuer Task", status: "pending", activeForm: "" }, // fuer sich allein gueltig
        { content: "Blockierter Task", status: "in_progress", activeForm: "" }, // Dependency-Regel schlaegt zu
      ];

      expect(() => syncTodos(ctx.db, ctx.taskService, ctx.boardService, todos)).toThrow();

      // Die gesamte Schleife lief in einer Transaktion -- auch der fuer sich
      // genommen gueltige erste Todo darf NICHT geschrieben worden sein.
      const after = ctx.taskService.listTasks();
      expect(after).toHaveLength(before.length);
      expect(after.some((t) => t.title === "Ganz neuer Task")).toBe(false);
    });
  });

  describe("Robustheit", () => {
    test("unbekannter status-Wert -> todo, kein Absturz", () => {
      ctx = createTestBoard();
      const todos = [
        { content: "Mysterioeser Status", status: "some-future-status", activeForm: "" },
      ] as unknown as TodoItem[];

      const report = syncTodos(ctx.db, ctx.taskService, ctx.boardService, todos);

      expect(report.created).toBe(1);
      const task = ctx.taskService.listTasks().find((t) => t.title === "Mysterioeser Status")!;
      expect(task.columnId).toBe("todo");
    });

    test("Todo verschwindet aus dem Payload -> Task bleibt unveraendert (kein Loeschen/Archivieren)", () => {
      ctx = createTestBoard();
      const existing = ctx.taskService.addTask({ title: "Bleibt" });
      ctx.taskService.moveTask(existing.id, "in-progress");

      const report = syncTodos(ctx.db, ctx.taskService, ctx.boardService, []);

      expect(report.created).toBe(0);
      expect(report.moved).toBe(0);
      const stillThere = ctx.taskService.getTask(existing.id);
      expect(stillThere).not.toBeNull();
      expect(stillThere!.columnId).toBe("in-progress");
      expect(stillThere!.archived).toBe(false);
    });

    test("Payload ohne id/priority (das echte TodoWrite-Schema) laeuft sauber durch", () => {
      ctx = createTestBoard();
      // Exakt das echte Schema (Plan Abschnitt 0.1) -- ueber JSON.parse, nicht
      // als Objekt-Literal, damit kein TS-Strukturzwang mitspielt.
      const raw = JSON.parse(
        '[{"content":"Echtes Todo","status":"pending","activeForm":"Arbeitet an etwas"}]',
      ) as TodoItem[];

      const report = syncTodos(ctx.db, ctx.taskService, ctx.boardService, raw);

      expect(report.created).toBe(1);
      expect(ctx.taskService.listTasks()[0]!.title).toBe("Echtes Todo");
    });
  });
});
