// Tests fuer die datenseitige Logik von src/tui/use-board.ts. Der Hook selbst
// (useBoard) braucht React-Rendering, um seine Regeln (useState/useCallback)
// auszufuehren -- dafuer gibt es im Repo kein Test-Werkzeug (kein
// ink-testing-library, keine neue Dependency ohne Ruecksprache, siehe
// CLAUDE.md). Getestet wird deshalb die extrahierte, reine Logik: loadData()
// und isOrphanTask() sind modul-exportiert genau dafuer (siehe Kommentare in
// use-board.ts). Die interaktiven Teile (Override-Dialog, addTask-Redirect)
// sind laut Plan/Kanban-Task manuell in der TUI zu verifizieren.
import { test, expect, describe, afterEach, mock } from "bun:test";
import { createTestBoard, type TestContext } from "./helpers.ts";
import * as dbModule from "../src/core/db.ts";
import { loadData, isOrphanTask } from "../src/tui/use-board.ts";
import type { Column, Task } from "../src/core/types.ts";

describe("loadData", () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  test("liefert Spalten in Config-Reihenfolge und alle aktiven Tasks", () => {
    ctx = createTestBoard();
    ctx.taskService.addTask({ title: "A" });
    ctx.taskService.addTask({ title: "B", columnId: "backlog" });

    const data = loadData(ctx.dir);
    expect(data.columns.map((c) => c.id)).toEqual(["backlog", "todo", "in-progress", "review", "done"]);
    expect(data.tasks).toHaveLength(2);
    expect(data.orphanColumnIds).toEqual([]);
  });

  test("findet Waisen ueber orphanColumnIds (Spalte fehlt in config.json)", () => {
    ctx = createTestBoard();
    const task = ctx.taskService.addTask({ title: "A" });
    ctx.db.run("UPDATE tasks SET column_id = 'geloeschte-spalte' WHERE id = ?", [task.id]);

    const data = loadData(ctx.dir);
    expect(data.orphanColumnIds).toEqual(["geloeschte-spalte"]);
    // Der Waisen-Task bleibt trotzdem in der Task-Liste -- P1-6: nicht verstecken.
    expect(data.tasks.find((t) => t.id === task.id)?.columnId).toBe("geloeschte-spalte");
  });
});

describe("isOrphanTask", () => {
  const columns: Column[] = [
    { id: "todo", name: "Todo", position: 0, wipLimit: 0, allowEntry: true, isTerminal: false },
    { id: "done", name: "Done", position: 1, wipLimit: 0, allowEntry: false, isTerminal: true },
  ];

  function makeTask(columnId: string): Task {
    return {
      id: "t1", title: "X", description: null, columnId, createdBy: "user",
      assignedTo: null, labels: [], createdAt: "", updatedAt: "", archived: false,
      version: 1, position: 0, priority: null, dueDate: null,
    };
  }

  test("false wenn die Spalte des Tasks bekannt ist", () => {
    expect(isOrphanTask(makeTask("todo"), columns)).toBe(false);
  });

  test("true wenn die Spalte des Tasks in 'columns' fehlt", () => {
    expect(isOrphanTask(makeTask("geloeschte-spalte"), columns)).toBe(true);
  });
});

// Kanban-Task 7Lnjgzi08s7p / GitHub #35: loadData() rief loadBoardConfig()
// zweimal auf (einmal in createServices(), einmal direkt danach nochmal) --
// jeder Refresh in der TUI las config.json also doppelt von Platte, parste
// und validierte sie doppelt. Fix: loadData() nutzt nur noch die eine
// BoardService-Instanz aus createServices(). Dieser Test haelt die Anzahl der
// Aufrufe fest, damit sich die Verdopplung nicht zurueckschleicht.
describe("#35 — loadBoardConfig wird pro loadData()-Aufruf genau einmal aufgerufen", () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  test("Zaehler-Spy zeigt exakt einen Aufruf je loadData()-Aufruf", () => {
    ctx = createTestBoard();
    ctx.taskService.addTask({ title: "A" });

    // Original-Funktion VOR dem Mocken in eine gewoehnliche Variable kopieren
    // (kein Import-Binding) -- sonst wuerde der Wrapper unten sich selbst
    // aufrufen, sobald mock.module() die Live-Binding umbiegt.
    const originalLoadBoardConfig = dbModule.loadBoardConfig;
    let callCount = 0;

    mock.module("../src/core/db.ts", () => ({
      ...dbModule,
      loadBoardConfig: (...args: Parameters<typeof originalLoadBoardConfig>) => {
        callCount++;
        return originalLoadBoardConfig(...args);
      },
    }));

    callCount = 0;
    loadData(ctx.dir);
    expect(callCount).toBe(1);

    callCount = 0;
    loadData(ctx.dir);
    expect(callCount).toBe(1);
  });
});
