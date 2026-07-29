// Tests fuer TransitionService — Kettenregel, WIP-Limit, Eintritt, Abschluss,
// Reconcile-Pfade, Protokollierung. Siehe Plan Abschnitt 3.1/3.2, Kanban P1-1.
import { test, expect, describe, afterEach } from "bun:test";
import { createTestBoard, type TestContext } from "./helpers.ts";
import { BoardService } from "../src/core/board-service.ts";
import { TransitionService } from "../src/core/transition-service.ts";
import type { ColumnConfig, Task } from "../src/core/types.ts";

// Baut ein Task-Fixture mit sinnvollen Defaults — fuer canMove/canEnter/
// canComplete reicht ein reines Objekt, es muss nicht in der DB stehen.
function makeTask(overrides: Partial<Task> = {}): Task {
  const now = new Date().toISOString();
  return {
    id: "fixture-task",
    title: "Fixture Task",
    description: null,
    columnId: "todo",
    createdBy: "user",
    assignedTo: null,
    labels: [],
    createdAt: now,
    updatedAt: now,
    archived: false,
    version: 1,
    position: 0,
    priority: null,
    dueDate: null,
    ...overrides,
  };
}

// Baut einen BoardService mit frei waehlbaren Spalten, ohne config.json auf
// Platte zu schreiben — fuer Tests, die beweisen sollen, dass die Regel aus
// der Array-Reihenfolge abgeleitet wird (3/7 Spalten, umsortiert, Terminal
// an anderer Position).
function makeBoardService(db: TestContext["db"], columns: ColumnConfig[]): BoardService {
  return new BoardService(db, {
    name: "Custom Board",
    createdAt: new Date().toISOString(),
    schemaVersion: 3,
    columns,
  });
}

const DEFAULT_COLUMN_IDS = ["backlog", "todo", "in-progress", "review", "done"];

describe("TransitionService", () => {
  let ctx: TestContext;
  let svc: TransitionService;
  afterEach(() => ctx?.cleanup());

  describe("canMove — Kettenregel (aus dem Spalten-Index abgeleitet)", () => {
    test("jede Spaltenkombination des Default-Boards folgt zielIndex <= quellIndex + 1 (5x5)", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);

      for (let sourceIdx = 0; sourceIdx < DEFAULT_COLUMN_IDS.length; sourceIdx++) {
        for (let targetIdx = 0; targetIdx < DEFAULT_COLUMN_IDS.length; targetIdx++) {
          const task = makeTask({ columnId: DEFAULT_COLUMN_IDS[sourceIdx]! });
          const result = svc.canMove(task, DEFAULT_COLUMN_IDS[targetIdx]!);
          const expected = targetIdx <= sourceIdx + 1;
          expect(result.allowed).toBe(expected);
        }
      }
    });

    test("Board mit 3 Spalten: Regel skaliert ohne Codeaenderung", () => {
      ctx = createTestBoard();
      const columns: ColumnConfig[] = [
        { id: "a", name: "A", wipLimit: 0, allowEntry: true, isTerminal: false },
        { id: "b", name: "B", wipLimit: 0, allowEntry: false, isTerminal: false },
        { id: "c", name: "C", wipLimit: 0, allowEntry: false, isTerminal: true },
      ];
      const boardService = makeBoardService(ctx.db, columns);
      svc = new TransitionService(ctx.db, boardService);

      expect(svc.canMove(makeTask({ columnId: "a" }), "b").allowed).toBe(true);
      expect(svc.canMove(makeTask({ columnId: "a" }), "c").allowed).toBe(false); // 2 Schritte
      expect(svc.canMove(makeTask({ columnId: "b" }), "c").allowed).toBe(true);
      expect(svc.canMove(makeTask({ columnId: "c" }), "a").allowed).toBe(true); // rueckwaerts frei
    });

    test("Board mit 7 Spalten: Regel skaliert ohne Codeaenderung", () => {
      ctx = createTestBoard();
      const ids = ["s0", "s1", "s2", "s3", "s4", "s5", "s6"];
      const columns: ColumnConfig[] = ids.map((id, i) => ({
        id,
        name: id,
        wipLimit: 0,
        allowEntry: i === 0,
        isTerminal: i === ids.length - 1,
      }));
      const boardService = makeBoardService(ctx.db, columns);
      svc = new TransitionService(ctx.db, boardService);

      expect(svc.canMove(makeTask({ columnId: "s2" }), "s3").allowed).toBe(true);
      expect(svc.canMove(makeTask({ columnId: "s2" }), "s4").allowed).toBe(false); // 2 Schritte
      expect(svc.canMove(makeTask({ columnId: "s2" }), "s0").allowed).toBe(true); // rueckwaerts frei
      expect(svc.canMove(makeTask({ columnId: "s6" }), "s0").allowed).toBe(true); // maximal rueckwaerts
    });

    test("Spalten in config.json umsortiert -> Regel folgt der neuen Reihenfolge", () => {
      ctx = createTestBoard();
      // Default-Reihenfolge umgekehrt: done, review, in-progress, todo, backlog
      const reversedIds = [...DEFAULT_COLUMN_IDS].reverse();
      const columns: ColumnConfig[] = reversedIds.map((id, i) => ({
        id,
        name: id,
        wipLimit: 0,
        allowEntry: i === 0 || i === 1,
        isTerminal: i === reversedIds.length - 1,
      }));
      const boardService = makeBoardService(ctx.db, columns);
      svc = new TransitionService(ctx.db, boardService);

      // Neue Reihenfolge (Index): done=0, review=1, in-progress=2, todo=3, backlog=4.
      // "todo" -> "backlog" ist jetzt der Vorwaerts-Nachbar (Index 3 -> 4).
      expect(svc.canMove(makeTask({ columnId: "todo" }), "backlog").allowed).toBe(true);
      // "done" -> "in-progress" ist jetzt 2 Schritte vorwaerts (Index 0 -> 2) -- abgelehnt,
      // obwohl "done" -> "in-progress" in der Default-Reihenfolge ein Ruecksprung war.
      expect(svc.canMove(makeTask({ columnId: "done" }), "in-progress").allowed).toBe(false);
      expect(svc.canMove(makeTask({ columnId: "done" }), "review").allowed).toBe(true); // done jetzt Index 0, review Index 1
    });

    test("zielIndex == quellIndex ist ein no-op, kein Fehler", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      const result = svc.canMove(makeTask({ columnId: "todo" }), "todo");
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    test("Zielspalte existiert nicht -> abgelehnt mit erklaerendem Text", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      const result = svc.canMove(makeTask({ columnId: "todo" }), "nope");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("nope");
    });

    test("Waisen-Spalte als Quelle -> alles erlaubt, auch in eine voll ausgelastete Zielspalte", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      ctx.taskService.addTask({ title: "A", columnId: "in-progress" });
      ctx.taskService.addTask({ title: "B", columnId: "in-progress" });
      ctx.taskService.addTask({ title: "C", columnId: "in-progress" });

      const task = makeTask({ columnId: "geloeschte-spalte" });
      expect(svc.canMove(task, "done").allowed).toBe(true);
      expect(svc.canMove(task, "backlog").allowed).toBe(true);
      // "alles erlaubt" heisst auch: WIP-Limit der Zielspalte greift hier nicht.
      expect(svc.canMove(task, "in-progress").allowed).toBe(true);
    });

    test("Kettenablehnung nennt Task, Quelle, Ziel und naechsten gueltigen Schritt", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      const task = makeTask({ title: "Backend-Migration schreiben", columnId: "todo" });
      const result = svc.canMove(task, "review");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Backend-Migration schreiben");
      expect(result.reason).toContain("Todo");
      expect(result.reason).toContain("Review");
      expect(result.reason).toContain("In Progress");
      expect(result.reason).toContain('kanban_move_task(id, "in-progress")');
    });
  });

  describe("canMove — WIP-Limit der Zielspalte", () => {
    test("volle Zielspalte lehnt weitere Moves ab", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      // In Progress hat wipLimit 3 (Default-Board)
      ctx.taskService.addTask({ title: "A", columnId: "in-progress" });
      ctx.taskService.addTask({ title: "B", columnId: "in-progress" });
      ctx.taskService.addTask({ title: "C", columnId: "in-progress" });

      const incoming = makeTask({ title: "D", columnId: "todo" });
      const result = svc.canMove(incoming, "in-progress");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("In Progress");
      expect(result.reason).toContain("voll (3 von 3)");
    });

    test("Zielspalte unter dem Limit erlaubt den Move", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      ctx.taskService.addTask({ title: "A", columnId: "in-progress" });
      ctx.taskService.addTask({ title: "B", columnId: "in-progress" });

      const incoming = makeTask({ title: "C", columnId: "todo" });
      expect(svc.canMove(incoming, "in-progress").allowed).toBe(true);
    });

    test("wipLimit 0 bedeutet unbegrenzt", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      for (let i = 0; i < 10; i++) {
        ctx.taskService.addTask({ title: `Task ${i}`, columnId: "todo" });
      }
      const incoming = makeTask({ title: "Elf", columnId: "backlog" });
      expect(svc.canMove(incoming, "todo").allowed).toBe(true);
    });

    test("WIP-Ablehnung nennt blockierende Tasks, Wartezeit (Fallback tasks.updated_at) und naechsten Schritt", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      const blocker = ctx.taskService.addTask({
        title: "Export-Service testen",
        columnId: "in-progress",
        assignedTo: "backend",
      });
      ctx.taskService.addTask({ title: "B", columnId: "in-progress" });
      ctx.taskService.addTask({ title: "C", columnId: "in-progress" });

      // Keine Transition-Historie fuer 'blocker' -> Fallback auf tasks.updated_at.
      // 4 Tage in die Vergangenheit setzen.
      const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
      ctx.db.run("UPDATE tasks SET updated_at = ? WHERE id = ?", [fourDaysAgo, blocker.id]);

      const incoming = makeTask({ title: "Neuer Task", columnId: "todo" });
      const result = svc.canMove(incoming, "in-progress");

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain(blocker.id.slice(0, 8));
      expect(result.reason).toContain("Export-Service testen");
      expect(result.reason).toContain("seit 4 Tagen");
      expect(result.reason).toContain("(backend)");
      expect(result.reason).toContain("Review"); // naechste Spalte nach In Progress
      expect(result.reason).toContain(".kanban/config.json");
    });

    test("WIP-Ablehnung bevorzugt transitions.created_at vor tasks.updated_at", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      const blocker = ctx.taskService.addTask({ title: "Alt, aber kuerzlich verschoben", columnId: "in-progress" });
      ctx.taskService.addTask({ title: "B", columnId: "in-progress" });
      ctx.taskService.addTask({ title: "C", columnId: "in-progress" });

      // updated_at sieht uralt aus (30 Tage) ...
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      ctx.db.run("UPDATE tasks SET updated_at = ? WHERE id = ?", [thirtyDaysAgo, blocker.id]);
      // ... aber es gibt eine neuere Transition IN die Spalte (vor 2 Stunden) --
      // die muss gewinnen, nicht der Fallback.
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      ctx.db.run(
        `INSERT INTO transitions (task_id, from_column, to_column, reported_by, reason, was_override, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [blocker.id, "todo", "in-progress", "user", null, 0, twoHoursAgo],
      );

      const incoming = makeTask({ title: "Neuer Task", columnId: "todo" });
      const result = svc.canMove(incoming, "in-progress");

      expect(result.reason).toContain("seit 2 Stunden");
      expect(result.reason).not.toContain("30 Tagen");
    });
  });

  describe("canEnter", () => {
    test("erlaubt Eintritt in Backlog und Todo", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      expect(svc.canEnter("backlog").allowed).toBe(true);
      expect(svc.canEnter("todo").allowed).toBe(true);
    });

    test('canEnter("done") -> false', () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      expect(svc.canEnter("done").allowed).toBe(false);
    });

    test("lehnt In Progress und Review als Eintrittsspalten ab, nennt gueltige Alternativen", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      const result = svc.canEnter("in-progress");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("backlog");
      expect(result.reason).toContain("todo");
    });

    test("lehnt unbekannte Spalte ab statt zu werfen", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      const result = svc.canEnter("nope");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("nope");
    });
  });

  describe("canComplete", () => {
    test("Task in Review (direkt vor der Terminal-Spalte) darf abschliessen", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      const task = makeTask({ columnId: "review" });
      expect(svc.canComplete(task).allowed).toBe(true);
    });

    test("Task in In Progress darf nicht abschliessen, Ablehnung nennt naechsten Schritt", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      const task = makeTask({ title: "Sync-Umbau", columnId: "in-progress" });
      const result = svc.canComplete(task);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Sync-Umbau");
      expect(result.reason).toContain("In Progress");
      expect(result.reason).toContain("Review");
      expect(result.reason).toContain('kanban_move_task(id, "review")');
    });

    test("Terminal-Spalte an anderer Position -> canComplete folgt mit, nicht hartkodiert auf 'review'", () => {
      ctx = createTestBoard();
      // Terminal-Spalte ("fertig") steht hier an Index 1, nicht am Ende --
      // canComplete muss trotzdem nur Tasks aus "vorbereitung" (Index 0) durchlassen.
      const columns: ColumnConfig[] = [
        { id: "vorbereitung", name: "Vorbereitung", wipLimit: 0, allowEntry: true, isTerminal: false },
        { id: "fertig", name: "Fertig", wipLimit: 0, allowEntry: false, isTerminal: true },
        { id: "archiv-kandidat", name: "Archiv-Kandidat", wipLimit: 0, allowEntry: false, isTerminal: false },
      ];
      const boardService = makeBoardService(ctx.db, columns);
      svc = new TransitionService(ctx.db, boardService);

      expect(svc.canComplete(makeTask({ columnId: "vorbereitung" })).allowed).toBe(true);
      expect(svc.canComplete(makeTask({ columnId: "archiv-kandidat" })).allowed).toBe(false);
    });
  });

  describe("reconcilePath — ausschliesslich fuer den Sync", () => {
    test('reconcilePath("todo", "done") liefert alle Zwischenspalten inklusive Ziel', () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      expect(svc.reconcilePath("todo", "done")).toEqual(["in-progress", "review", "done"]);
    });

    test('reconcilePath("done", "todo") liefert einen direkten Ruecksprung', () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      expect(svc.reconcilePath("done", "todo")).toEqual(["todo"]);
    });

    test("reconcilePath auf dieselbe Spalte liefert einen leeren Pfad", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      expect(svc.reconcilePath("todo", "todo")).toEqual([]);
    });

    test("reconcilePath ignoriert die Kettenregel -- auch ein weiter Vorwaertssprung liefert einen Pfad", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      // backlog -> done waere per canMove abgelehnt (4 Schritte); reconcilePath
      // ist keine Regelpruefung, sondern reine Wegberechnung fuer den Sync.
      expect(svc.reconcilePath("backlog", "done")).toEqual(["todo", "in-progress", "review", "done"]);
    });
  });

  describe("log / history", () => {
    test("log() speichert eine Transition, history() liest sie zurueck", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      const task = ctx.taskService.addTask({ title: "Task" });

      svc.log(task.id, "todo", "in-progress", "backend", null, false);

      const history = svc.history(task.id);
      expect(history).toHaveLength(1);
      expect(history[0]!.taskId).toBe(task.id);
      expect(history[0]!.fromColumn).toBe("todo");
      expect(history[0]!.toColumn).toBe("in-progress");
      expect(history[0]!.reportedBy).toBe("backend");
      expect(history[0]!.reason).toBeNull();
    });

    test("log() erlaubt fromColumn: null fuer die Task-Entstehung", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      const task = ctx.taskService.addTask({ title: "Task" });

      svc.log(task.id, null, "todo", "user", null, false);

      const history = svc.history(task.id);
      expect(history[0]!.fromColumn).toBeNull();
    });

    test("log() schreibt was_override korrekt (true und false)", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      const task = ctx.taskService.addTask({ title: "Task" });

      svc.log(task.id, "todo", "in-progress", "user", null, false);
      svc.log(task.id, "in-progress", "done", "user", "TUI-Override", true);

      const history = svc.history(task.id);
      expect(history[0]!.wasOverride).toBe(false);
      expect(history[1]!.wasOverride).toBe(true);
      expect(history[1]!.reason).toBe("TUI-Override");
    });

    test("log() akzeptiert die dokumentierten Ausnahme-Reasons (restore, orphan-recovery, reconcile)", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      const task = ctx.taskService.addTask({ title: "Task" });

      svc.log(task.id, null, "todo", "user", "restore", false);
      svc.log(task.id, "todo", "done", "sync", "reconcile", false);
      svc.log(task.id, "geloeschte-spalte", "todo", "user", "orphan-recovery", false);

      const reasons = svc.history(task.id).map((t) => t.reason);
      expect(reasons).toEqual(["restore", "reconcile", "orphan-recovery"]);
    });

    test("history() liefert chronologisch aufsteigend", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      const task = ctx.taskService.addTask({ title: "Task" });

      svc.log(task.id, "todo", "in-progress", "user", "erste", false);
      svc.log(task.id, "in-progress", "review", "user", "zweite", false);
      svc.log(task.id, "review", "done", "user", "dritte", false);

      const history = svc.history(task.id);
      expect(history.map((t) => t.reason)).toEqual(["erste", "zweite", "dritte"]);
    });

    test("history() nutzt die Insert-Reihenfolge (id) als Tie-Breaker bei gleichem Zeitstempel", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      const task = ctx.taskService.addTask({ title: "Task" });
      const sameInstant = new Date().toISOString();

      // Identischer Zeitstempel fuer alle drei Zeilen -- ohne 'id ASC' als
      // Tie-Breaker waere die Reihenfolge von SQLite nicht garantiert.
      const insertTransition = ctx.db.prepare(
        `INSERT INTO transitions (task_id, from_column, to_column, reported_by, reason, was_override, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
      );
      insertTransition.run(task.id, "todo", "in-progress", "user", "erste", sameInstant);
      insertTransition.run(task.id, "in-progress", "review", "user", "zweite", sameInstant);
      insertTransition.run(task.id, "review", "done", "user", "dritte", sameInstant);

      const history = svc.history(task.id);
      expect(history.map((t) => t.reason)).toEqual(["erste", "zweite", "dritte"]);
    });

    test("history() ist leer fuer einen Task ohne Historie", () => {
      ctx = createTestBoard();
      svc = new TransitionService(ctx.db, ctx.boardService);
      const task = ctx.taskService.addTask({ title: "Task" });
      expect(svc.history(task.id)).toEqual([]);
    });
  });
});
