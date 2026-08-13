// Tests fuer die Durchsetzung der Zustandsmaschine in TaskService (P1-2):
// addTask/moveTask/completeTask laufen jetzt durch TransitionService, jeder
// Uebergang wird protokolliert. Siehe Kanban-Task BaG-dRwgp-qR, GitHub #18.
import { test, expect, describe, afterEach } from "bun:test";
import { createTestBoard, type TestContext } from "./helpers.ts";
import { TransitionService } from "../src/core/transition-service.ts";

describe("TaskService — Zustandsmaschine (P1-2)", () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  describe("addTask — nur Eintrittsspalten, protokolliert die Entstehung", () => {
    test("klappt in Backlog und Todo", () => {
      ctx = createTestBoard();
      expect(ctx.taskService.addTask({ title: "A", columnId: "backlog" }).columnId).toBe("backlog");
      expect(ctx.taskService.addTask({ title: "B", columnId: "todo" }).columnId).toBe("todo");
    });

    test("scheitert in In Progress, Review und Done", () => {
      ctx = createTestBoard();
      expect(() => ctx.taskService.addTask({ title: "X", columnId: "in-progress" })).toThrow();
      expect(() => ctx.taskService.addTask({ title: "X", columnId: "review" })).toThrow();
      expect(() => ctx.taskService.addTask({ title: "X", columnId: "done" })).toThrow();
    });

    test("Ablehnungstext ist handlungsleitend (nennt gueltige Eintrittsspalten)", () => {
      ctx = createTestBoard();
      expect(() => ctx.taskService.addTask({ title: "X", columnId: "done" })).toThrow(/backlog.*todo|todo.*backlog/);
    });

    test("protokolliert die Entstehung als Transition mit from_column: null", () => {
      ctx = createTestBoard();
      const transitions = new TransitionService(ctx.db, ctx.boardService);
      const task = ctx.taskService.addTask({ title: "A", createdBy: "backend", reportedBy: "backend" });

      const history = transitions.history(task.id);
      expect(history).toHaveLength(1);
      expect(history[0]!.fromColumn).toBeNull();
      expect(history[0]!.toColumn).toBe("todo");
      expect(history[0]!.reportedBy).toBe("backend");
      expect(history[0]!.wasOverride).toBe(false);
    });

    // P1-3 (K-3): reportedBy gilt nur fuer Transitions und ist von createdBy
    // getrennt -- kein automatischer Fallback von reportedBy auf createdBy,
    // sonst waeren die beiden Felder faktisch dasselbe.
    test("reportedBy ist von createdBy getrennt -- faellt ohne eigenen Wert auf 'user' zurueck, nicht auf createdBy", () => {
      ctx = createTestBoard();
      const transitions = new TransitionService(ctx.db, ctx.boardService);
      const task = ctx.taskService.addTask({ title: "A", createdBy: "planer" }); // kein reportedBy

      expect(task.createdBy).toBe("planer");
      const history = transitions.history(task.id);
      expect(history[0]!.reportedBy).toBe("user");
    });
  });

  describe("moveTask — Kettenregel", () => {
    test("todo -> review scheitert (2 Schritte)", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X" });
      expect(() => ctx.taskService.moveTask(task.id, "review")).toThrow();
    });

    test("todo -> in-progress klappt (1 Schritt)", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X" });
      expect(ctx.taskService.moveTask(task.id, "in-progress").columnId).toBe("in-progress");
    });

    test("done -> backlog klappt (Ruecksprung beliebiger Weite)", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X" });
      // Direkt nach Done -- ohne Kettenregel unmoeglich, hier bewusst per
      // Override, weil dieser Test nur den Ruecksprung pruefen soll.
      ctx.taskService.moveTask(task.id, "done", { override: true });
      const back = ctx.taskService.moveTask(task.id, "backlog");
      expect(back.columnId).toBe("backlog");
    });

    test("jede erlaubte Bewegung erzeugt genau eine Transition", () => {
      ctx = createTestBoard();
      const transitions = new TransitionService(ctx.db, ctx.boardService);
      const task = ctx.taskService.addTask({ title: "X" }); // 1. Transition (Entstehung)
      ctx.taskService.moveTask(task.id, "in-progress"); // 2. Transition

      const history = transitions.history(task.id);
      expect(history).toHaveLength(2);
      expect(history[1]!.fromColumn).toBe("todo");
      expect(history[1]!.toColumn).toBe("in-progress");
    });

    test("override: true umgeht die Kettenregel und setzt was_override = 1", () => {
      ctx = createTestBoard();
      const transitions = new TransitionService(ctx.db, ctx.boardService);
      const task = ctx.taskService.addTask({ title: "X" });

      const moved = ctx.taskService.moveTask(task.id, "done", { override: true, reason: "Testfall" });
      expect(moved.columnId).toBe("done");

      const history = transitions.history(task.id);
      const last = history[history.length - 1]!;
      expect(last.wasOverride).toBe(true);
      expect(last.reason).toBe("Testfall");
    });
  });

  describe("moveTask — WIP-Limit", () => {
    test("Move in volle Spalte (wipLimit 3, 3 Tasks) scheitert", () => {
      ctx = createTestBoard();
      const a = ctx.taskService.addTask({ title: "A" });
      const b = ctx.taskService.addTask({ title: "B" });
      const c = ctx.taskService.addTask({ title: "C" });
      const d = ctx.taskService.addTask({ title: "D" });
      ctx.taskService.moveTask(a.id, "in-progress");
      ctx.taskService.moveTask(b.id, "in-progress");
      ctx.taskService.moveTask(c.id, "in-progress");

      expect(() => ctx.taskService.moveTask(d.id, "in-progress")).toThrow(/voll/);
    });

    test("mit wipPolicy: 'log' wird die volle Spalte NICHT abgelehnt, aber als Override protokolliert", () => {
      ctx = createTestBoard();
      const transitions = new TransitionService(ctx.db, ctx.boardService);
      const a = ctx.taskService.addTask({ title: "A" });
      const b = ctx.taskService.addTask({ title: "B" });
      const c = ctx.taskService.addTask({ title: "C" });
      const d = ctx.taskService.addTask({ title: "D" });
      ctx.taskService.moveTask(a.id, "in-progress");
      ctx.taskService.moveTask(b.id, "in-progress");
      ctx.taskService.moveTask(c.id, "in-progress");

      const moved = ctx.taskService.moveTask(d.id, "in-progress", { wipPolicy: "log", reportedBy: "sync" });
      expect(moved.columnId).toBe("in-progress");

      const history = transitions.history(d.id);
      const last = history[history.length - 1]!;
      expect(last.wasOverride).toBe(true);
      expect(last.reason).toBe("wip-exceeded (sync)");
      expect(last.reportedBy).toBe("sync");
    });

    test("wipPolicy: 'log' laesst die Kettenregel trotzdem hart bleiben", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X" });
      // todo -> review ist 2 Schritte -- 'log' betrifft nur WIP, nicht die Kette.
      expect(() => ctx.taskService.moveTask(task.id, "review", { wipPolicy: "log" })).toThrow();
    });
  });

  describe("completeTask", () => {
    test("aus In Progress scheitert", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X" });
      ctx.taskService.moveTask(task.id, "in-progress");
      expect(() => ctx.taskService.completeTask(task.id)).toThrow();
    });

    test("aus Review klappt", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "X" });
      ctx.taskService.moveTask(task.id, "in-progress");
      ctx.taskService.moveTask(task.id, "review");
      expect(ctx.taskService.completeTask(task.id).columnId).toBe("done");
    });

    // P1-3: completeTask akzeptiert jetzt optional reportedBy fuer die
    // Transition -- Default "user" bleibt fuer CLI/TUI/Skripte, die es
    // weglassen (siehe MoveTaskOptions/addTask, gleiches Muster).
    test("reportedBy landet in der Transition, Default 'user' ohne Angabe", () => {
      ctx = createTestBoard();
      const transitions = new TransitionService(ctx.db, ctx.boardService);
      const task = ctx.taskService.addTask({ title: "X" });
      ctx.taskService.moveTask(task.id, "in-progress");
      ctx.taskService.moveTask(task.id, "review");

      ctx.taskService.completeTask(task.id, { reportedBy: "backend" });

      const history = transitions.history(task.id);
      const last = history[history.length - 1]!;
      expect(last.toColumn).toBe("done");
      expect(last.reportedBy).toBe("backend");
    });

    test("completeTask geht nicht durch das oeffentliche moveTask (keine doppelte Kettenpruefung)", () => {
      // Reiner Abgrenzungstest: eine Terminal-Spalte mit WIP-Limit wuerde bei
      // Delegation an moveTask() faelschlich per canMove/WIP abgelehnt, obwohl
      // canComplete (Position vor Terminal) laengst gruen ist. Default-Board
      // hat wipLimit 0 auf "done", das ist hier also implizit mitgeprueft.
      ctx = createTestBoard();
      const transitions = new TransitionService(ctx.db, ctx.boardService);
      const task = ctx.taskService.addTask({ title: "X" });
      ctx.taskService.moveTask(task.id, "in-progress");
      ctx.taskService.moveTask(task.id, "review");
      ctx.taskService.completeTask(task.id);

      const history = transitions.history(task.id);
      const last = history[history.length - 1]!;
      expect(last.toColumn).toBe("done");
      expect(last.wasOverride).toBe(false);
    });
  });

  describe("restoreTask — keine Regelpruefung, aber protokolliert", () => {
    test("restauriert aus jeder Spalte ohne Kettenpruefung und loggt reason: 'restore'", () => {
      ctx = createTestBoard();
      const transitions = new TransitionService(ctx.db, ctx.boardService);
      const task = ctx.taskService.addTask({ title: "X" });
      ctx.taskService.moveTask(task.id, "done", { override: true });
      ctx.taskService.archiveTask(task.id);

      // Direkt zurueck nach "done" -- waere per Kettenregel nie erlaubt
      // (keine Quellspalte, da archiviert), restoreTask prueft trotzdem nicht.
      const restored = ctx.taskService.restoreTask(task.id, "done");
      expect(restored.columnId).toBe("done");
      expect(restored.archived).toBe(false);

      const history = transitions.history(task.id);
      const last = history[history.length - 1]!;
      expect(last.reason).toBe("restore");
      expect(last.toColumn).toBe("done");
      expect(last.wasOverride).toBe(false);
    });
  });

  // Teamlead-Vorgabe (nicht in den urspruenglichen P1-2-Notes, siehe Bericht
  // an team-lead zu P1-1): ein blockierter Task darf geplant, aber nicht
  // bearbeitet werden. Vorwaerts in eine Spalte mit allowEntry: false wird
  // abgelehnt, solange isBlocked gilt; rueckwaerts und zwischen
  // Eintrittsspalten bleibt es erlaubt.
  describe("Dependency-Regel: blockierter Task darf geplant, nicht bearbeitet werden", () => {
    test("Vorwaerts-Move in Arbeitsspalte (allowEntry: false) scheitert waehrend isBlocked", () => {
      ctx = createTestBoard();
      const blocker = ctx.taskService.addTask({ title: "Schema migrieren" });
      const task = ctx.taskService.addTask({ title: "Abhaengiger Task", dependsOn: [blocker.id] });
      expect(ctx.taskService.isBlocked(task.id)).toBe(true);

      expect(() => ctx.taskService.moveTask(task.id, "in-progress")).toThrow();
    });

    test("Ablehnungstext nennt die offene Abhaengigkeit namentlich", () => {
      ctx = createTestBoard();
      const blocker = ctx.taskService.addTask({ title: "Schema migrieren" });
      const task = ctx.taskService.addTask({ title: "Abhaengiger Task", dependsOn: [blocker.id] });

      let message = "";
      try {
        ctx.taskService.moveTask(task.id, "in-progress");
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain("Abhaengiger Task");
      expect(message).toContain(blocker.id.slice(0, 8));
      expect(message).toContain("Schema migrieren");
      expect(message).toContain("kanban_remove_dependency");
    });

    test("Rueckwaerts bleibt erlaubt, auch waehrend isBlocked", () => {
      ctx = createTestBoard();
      const blocker = ctx.taskService.addTask({ title: "Blocker" });
      const task = ctx.taskService.addTask({ title: "Task" });
      ctx.taskService.moveTask(task.id, "in-progress");
      ctx.taskService.moveTask(task.id, "review");
      ctx.taskService.addDependency(task.id, blocker.id); // jetzt blockiert, sitzt aber schon in Review
      expect(ctx.taskService.isBlocked(task.id)).toBe(true);

      // Review -> Todo ist ein Ruecksprung -- muss trotz isBlocked klappen.
      expect(ctx.taskService.moveTask(task.id, "todo").columnId).toBe("todo");
    });

    test("Moves zwischen Eintrittsspalten (Backlog <-> Todo) bleiben erlaubt waehrend isBlocked", () => {
      ctx = createTestBoard();
      const blocker = ctx.taskService.addTask({ title: "Blocker" });
      const task = ctx.taskService.addTask({ title: "Task", columnId: "backlog", dependsOn: [blocker.id] });
      expect(ctx.taskService.isBlocked(task.id)).toBe(true);

      expect(ctx.taskService.moveTask(task.id, "todo").columnId).toBe("todo");
      expect(ctx.taskService.moveTask(task.id, "backlog").columnId).toBe("backlog");
    });

    test("completeTask scheitert fuer einen blockierten Task, auch wenn er in Review steht", () => {
      ctx = createTestBoard();
      const blocker = ctx.taskService.addTask({ title: "Blocker" });
      const task = ctx.taskService.addTask({ title: "Task", dependsOn: [blocker.id] });
      // Task per Override direkt nach Review setzen, um die Positionsregel
      // (canComplete) zu erfuellen und ISOLIERT die Dependency-Regel zu pruefen.
      ctx.taskService.moveTask(task.id, "review", { override: true });
      expect(ctx.taskService.isBlocked(task.id)).toBe(true);

      expect(() => ctx.taskService.completeTask(task.id)).toThrow(/Abhaengigkeit/);
    });

    test("nach Aufloesen der Abhaengigkeit (Blocker fertig) klappt derselbe Move", () => {
      ctx = createTestBoard();
      const blocker = ctx.taskService.addTask({ title: "Blocker" });
      const task = ctx.taskService.addTask({ title: "Task", dependsOn: [blocker.id] });

      ctx.taskService.moveTask(blocker.id, "in-progress");
      ctx.taskService.moveTask(blocker.id, "review");
      ctx.taskService.completeTask(blocker.id);
      expect(ctx.taskService.isBlocked(task.id)).toBe(false);

      expect(ctx.taskService.moveTask(task.id, "in-progress").columnId).toBe("in-progress");
    });

    test("override: true umgeht auch die Dependency-Regel", () => {
      ctx = createTestBoard();
      const blocker = ctx.taskService.addTask({ title: "Blocker" });
      const task = ctx.taskService.addTask({ title: "Task", dependsOn: [blocker.id] });

      const moved = ctx.taskService.moveTask(task.id, "in-progress", { override: true });
      expect(moved.columnId).toBe("in-progress");
    });

    test("unblockierter Task ist von der Regel unberuehrt", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "Task ohne Abhaengigkeiten" });
      expect(ctx.taskService.isBlocked(task.id)).toBe(false);
      expect(ctx.taskService.moveTask(task.id, "in-progress").columnId).toBe("in-progress");
    });
  });

  // GitHub #45: applyMove() protokollierte jeden Aufruf, auch wenn Quell- und
  // Zielspalte identisch waren -- Eintraege der Form 'todo -> todo', die einen
  // Zustandswechsel behaupten, der nie stattfand, und den Task zusaetzlich ans
  // Ende der Spalte schoben.
  describe("moveTask — No-Op in die eigene Spalte (#45)", () => {
    test("schreibt keine Transition", () => {
      ctx = createTestBoard();
      const transitions = new TransitionService(ctx.db, ctx.boardService);
      const task = ctx.taskService.addTask({ title: "A" });
      const before = transitions.history(task.id).length;

      ctx.taskService.moveTask(task.id, "todo", { reportedBy: "teamlead" });

      expect(transitions.history(task.id)).toHaveLength(before);
    });

    test("laesst die Position unveraendert — die Reihenfolge bleibt stehen", () => {
      ctx = createTestBoard();
      const first = ctx.taskService.addTask({ title: "Erster" });
      const second = ctx.taskService.addTask({ title: "Zweiter" });

      ctx.taskService.moveTask(first.id, "todo", { reportedBy: "teamlead" });

      expect(ctx.taskService.getTask(first.id)!.position).toBe(first.position);
      expect(ctx.taskService.getTask(second.id)!.position).toBe(second.position);
    });

    test("gibt den Task zurueck, wirft nicht", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "A" });

      const result = ctx.taskService.moveTask(task.id, "todo");

      expect(result.id).toBe(task.id);
      expect(result.columnId).toBe("todo");
    });

    test("unbekannte Spalte wird weiterhin abgelehnt", () => {
      ctx = createTestBoard();
      const task = ctx.taskService.addTask({ title: "A" });
      expect(() => ctx.taskService.moveTask(task.id, "gibt-es-nicht")).toThrow(/existiert nicht/);
    });

    test("echter Spaltenwechsel wird unveraendert protokolliert", () => {
      ctx = createTestBoard();
      const transitions = new TransitionService(ctx.db, ctx.boardService);
      const task = ctx.taskService.addTask({ title: "A" });

      ctx.taskService.moveTask(task.id, "in-progress", { reportedBy: "backend" });

      const history = transitions.history(task.id);
      expect(history).toHaveLength(2);
      expect(history[1]!.fromColumn).toBe("todo");
      expect(history[1]!.toColumn).toBe("in-progress");
    });
  });
});
