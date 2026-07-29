// Tests fuer Export/Import als ZIP-Archiv (P0-6). Vor diesem Task gab es hier
// keine Testdatei — deshalb blieb der kaputte v2-Import unbemerkt (er
// schrieb noch in die seit Schema v3 nicht mehr existierende 'columns'-Tabelle).
//
// P0-5 (Schema-Guard) wird hier nur an der Grenze mitgetestet (exportBoard
// verweigert ein v2-Board) — die Guard-Logik selbst hat eigene Tests in
// db.test.ts/mcp-context.test.ts.
import { test, expect, describe, afterEach } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { $ } from "bun";
import {
  createTestBoard,
  createLegacyV2Board,
  type TestContext,
  type LegacyBoardContext,
} from "./helpers.ts";
import { exportBoard, importBoard } from "../src/core/export-service.ts";
import { openDb, boardExists, getBoardPaths, loadBoardConfig } from "../src/core/db.ts";
import { NotesService } from "../src/core/notes-service.ts";

const FIXTURE_V2_ZIP = join(import.meta.dir, "fixtures", "board-backup-v2.zip");

function tmpDir(prefix = "kanban-export-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// Baut ein synthetisches v2-ZIP direkt aus einem board.json-Objekt (fuer
// Faelle, die das echte Fixture nicht abdeckt, z.B. lueckenhafte 'position').
// Gleicher Bau-Mechanismus (Staging-Ordner + 'zip -r') wie exportBoard selbst.
async function buildV2Zip(
  dir: string,
  board: unknown,
  notes?: Record<string, string>,
): Promise<string> {
  const stageDir = join(dir, "_stage");
  mkdirSync(stageDir, { recursive: true });
  writeFileSync(join(stageDir, "board.json"), JSON.stringify(board, null, 2));
  if (notes) {
    const notesDir = join(stageDir, "notes");
    mkdirSync(notesDir, { recursive: true });
    for (const [id, content] of Object.entries(notes)) {
      writeFileSync(join(notesDir, `${id}.md`), content);
    }
  }
  const zipPath = join(dir, "synthetic-v2.zip");
  await $`cd ${stageDir} && zip -r ${zipPath} .`.quiet();
  return zipPath;
}

describe("exportBoard", () => {
  let ctx: TestContext | undefined;
  let legacy: LegacyBoardContext | undefined;
  const dirs: string[] = [];
  afterEach(() => {
    ctx?.cleanup();
    legacy?.cleanup();
    ctx = undefined;
    legacy = undefined;
    dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
    dirs.length = 0;
  });

  test("v3-Rundreise: Export dann Import liefert Tasks, Dependencies, Notes, Transitions, Spalten (inkl. Reihenfolge) identisch", async () => {
    ctx = createTestBoard("Rundreise Board");
    const t1 = ctx.taskService.addTask({ title: "Task A", notes: "Notiz A" });
    const t2 = ctx.taskService.addTask({ title: "Task B", columnId: "todo" });
    ctx.taskService.addDependency(t2.id, t1.id);
    // addTask() protokolliert seit P1-2 selbst schon die Entstehung (from_column
    // NULL) -- t1 und t2 haben also bereits je eine Transition, bevor unten
    // noch eine dritte (manuell) dazukommt.

    // priority/dueDate sind echte Spalten seit Paket 0, aber das Setzen ueber
    // CLI/MCP kommt erst in Paket 2 (nicht Teil dieses Tasks) — deshalb hier
    // direkt per SQL gesetzt, um die Export/Import-Plumbing zu pruefen.
    ctx.db.run("UPDATE tasks SET priority = ?, due_date = ? WHERE id = ?", ["high", "2026-08-01", t1.id]);

    // Eine weitere, manuell konstruierte Transition fuer t1 -- zusaetzlich zu
    // der von addTask() bereits erzeugten -- um Export/Import einer echten
    // Mehrfach-Historie zu pruefen (P1-2, war vorher nur eine einzelne
    // synthetische Zeile, weil addTask() selbst noch nichts protokollierte).
    const now = new Date().toISOString();
    ctx.db.run(
      `INSERT INTO transitions (task_id, from_column, to_column, reported_by, reason, was_override, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [t1.id, null, "todo", "user", "Testtransition", 0, now],
    );

    const originalColumns = loadBoardConfig(getBoardPaths(ctx.dir).configPath).columns;

    const outDir = tmpDir();
    dirs.push(outDir);
    const zipPath = join(outDir, "export.zip");
    const resultPath = await exportBoard(ctx.dir, zipPath);
    expect(resultPath).toBe(zipPath);
    expect(existsSync(zipPath)).toBe(true);

    // board.json direkt inspizieren: Version 3, transitions-Array vorhanden
    const inspectDir = join(outDir, "inspect");
    mkdirSync(inspectDir, { recursive: true });
    await $`unzip -o ${zipPath} -d ${inspectDir}`.quiet();
    const boardJson = JSON.parse(readFileSync(join(inspectDir, "board.json"), "utf-8"));
    expect(boardJson.version).toBe(3);
    expect(Array.isArray(boardJson.transitions)).toBe(true);
    // 3 = je 1 Entstehungs-Transition fuer t1 und t2 (addTask(), P1-2) + die
    // manuell eingefuegte "Testtransition" oben.
    expect(boardJson.transitions).toHaveLength(3);
    expect(boardJson.columns).toEqual(originalColumns);
    for (const col of boardJson.columns) {
      expect(col).not.toHaveProperty("position");
    }

    // In ein leeres Verzeichnis re-importieren
    const newDir = tmpDir();
    dirs.push(newDir);
    const report = await importBoard(newDir, zipPath);
    expect(report.sourceVersion).toBe(3);

    const newConfig = loadBoardConfig(getBoardPaths(newDir).configPath);
    expect(newConfig.schemaVersion).toBe(3);
    expect(newConfig.columns).toEqual(originalColumns);

    const db2 = openDb(getBoardPaths(newDir).dbPath);
    const taskCount = (db2.query("SELECT COUNT(*) as c FROM tasks").get() as { c: number }).c;
    expect(taskCount).toBe(2);

    const t1Row = db2.query("SELECT priority, due_date FROM tasks WHERE id = ?").get(t1.id) as
      | { priority: string; due_date: string }
      | null;
    expect(t1Row).not.toBeNull();
    expect(t1Row!.priority).toBe("high");
    expect(t1Row!.due_date).toBe("2026-08-01");

    const depCount = (
      db2.query("SELECT COUNT(*) as c FROM dependencies WHERE task_id = ? AND depends_on_id = ?").get(t2.id, t1.id) as { c: number }
    ).c;
    expect(depCount).toBe(1);

    const transitions = db2.query("SELECT * FROM transitions WHERE task_id = ?").all(t1.id) as Array<{
      to_column: string;
      reason: string | null;
    }>;
    // 2 = die von addTask() erzeugte Entstehungs-Transition + die manuelle
    // "Testtransition" -- beide muessen den Rundtrip ueberstehen.
    expect(transitions).toHaveLength(2);
    const testTransition = transitions.find((t) => t.reason === "Testtransition");
    expect(testTransition).toBeDefined();
    expect(testTransition!.to_column).toBe("todo");
    db2.close();

    const notesService = new NotesService(getBoardPaths(newDir).kanbanDir);
    expect(notesService.load(t1.id)).toBe("Notiz A");
  });

  test("verweigert ein v2-Board (P0-5-Guard) und erzeugt keine ZIP-Datei", async () => {
    legacy = createLegacyV2Board();
    const outDir = tmpDir();
    dirs.push(outDir);
    const outPath = join(outDir, "should-not-exist.zip");

    await expect(exportBoard(legacy.dir, outPath)).rejects.toThrow(/kanban migrate/);
    expect(existsSync(outPath)).toBe(false);
  });
});

describe("importBoard - v2 (Rueckwaerts-Kompatibilitaet, Pflicht)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
    dirs.length = 0;
  });

  test("importiert ein echtes v2-ZIP direkt als v3-Board — kein 'kanban migrate' noetig", async () => {
    const dir = tmpDir();
    dirs.push(dir);

    const report = await importBoard(dir, FIXTURE_V2_ZIP);
    expect(report.sourceVersion).toBe(2);
    expect(report.note).toContain("v2-Archiv importiert");
    expect(report.note).toContain("Eintrittsspalten: backlog, todo");

    expect(boardExists(dir)).toBe(true);

    // Rohe config.json pruefen: schemaVersion 3, Spalten geordnet, kein 'position'-Feld
    const rawConfig = JSON.parse(readFileSync(getBoardPaths(dir).configPath, "utf-8"));
    expect(rawConfig.schemaVersion).toBe(3);
    expect(rawConfig.columns.map((c: { id: string }) => c.id)).toEqual([
      "backlog", "todo", "in-progress", "review", "done",
    ]);
    for (const col of rawConfig.columns) {
      expect(col).not.toHaveProperty("position");
    }
    const allowEntryById = Object.fromEntries(
      rawConfig.columns.map((c: { id: string; allowEntry: boolean }) => [c.id, c.allowEntry]),
    );
    expect(allowEntryById.backlog).toBe(true);
    expect(allowEntryById.todo).toBe(true);
    expect(allowEntryById["in-progress"]).toBe(false);
    expect(allowEntryById.review).toBe(false);
    expect(allowEntryById.done).toBe(false);

    // openDb() darf NICHT werfen — das Board ist bereits v3, kein Migrate noetig
    const db = openDb(getBoardPaths(dir).dbPath);

    const taskCount = (db.query("SELECT COUNT(*) as c FROM tasks").get() as { c: number }).c;
    expect(taskCount).toBe(44);

    const depCount = (db.query("SELECT COUNT(*) as c FROM dependencies").get() as { c: number }).c;
    expect(depCount).toBe(49);

    const transitionCount = (db.query("SELECT COUNT(*) as c FROM transitions").get() as { c: number }).c;
    expect(transitionCount).toBe(0);

    const withMetaCount = (
      db.query("SELECT COUNT(*) as c FROM tasks WHERE priority IS NOT NULL OR due_date IS NOT NULL").get() as { c: number }
    ).c;
    expect(withMetaCount).toBe(0);

    db.close();

    // Notes wurden mitkopiert (Task 'TdQuQ2RcZQFA' hat im Fixture hasNotes: true)
    const notesService = new NotesService(getBoardPaths(dir).kanbanDir);
    expect(notesService.exists("TdQuQ2RcZQFA")).toBe(true);
  });

  test("v2-ZIP mit lueckenhafter position (0, 2, 7) behaelt die richtige Reihenfolge", async () => {
    const dir = tmpDir();
    dirs.push(dir);

    const board = {
      version: 2,
      exportedAt: new Date().toISOString(),
      config: { name: "Gap Board", createdAt: new Date().toISOString() },
      columns: [
        { id: "a", name: "A", position: 7, wipLimit: 0, isTerminal: false },
        { id: "b", name: "B", position: 0, wipLimit: 0, isTerminal: true },
        { id: "c", name: "C", position: 2, wipLimit: 0, isTerminal: false },
      ],
      tasks: [
        {
          id: "task-1", title: "Einziger Task", description: null, columnId: "b",
          createdBy: "user", assignedTo: null, labels: [],
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          archived: false, version: 1, position: 0,
        },
      ],
      dependencies: [],
    };

    const zipPath = await buildV2Zip(dir, board);
    const importDir = tmpDir();
    dirs.push(importDir);
    await importBoard(importDir, zipPath);

    const config = loadBoardConfig(getBoardPaths(importDir).configPath);
    expect(config.columns.map((c) => c.id)).toEqual(["b", "c", "a"]);
    const allowEntryById = Object.fromEntries(config.columns.map((c) => [c.id, c.allowEntry]));
    expect(allowEntryById.b).toBe(true);
    expect(allowEntryById.c).toBe(true);
    expect(allowEntryById.a).toBe(false);
  });

  test("lehnt eine unbekannte/zu hohe Export-Version ab", async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const board = {
      version: 99,
      exportedAt: new Date().toISOString(),
      config: { name: "Future Board", createdAt: new Date().toISOString() },
      columns: [],
      tasks: [],
      dependencies: [],
    };
    const zipPath = await buildV2Zip(dir, board);
    const importDir = tmpDir();
    dirs.push(importDir);

    await expect(importBoard(importDir, zipPath)).rejects.toThrow(/Inkompatible Schema-Version/);
  });

  test("--force ueberschreibt ein bestehendes Board mit dem v2-Import", async () => {
    const dir = tmpDir();
    dirs.push(dir);
    // Erst ein leeres v3-Board anlegen, dann mit --force durch den v2-Import ersetzen
    const { initBoard } = await import("../src/core/db.ts");
    initBoard(dir, "Wird ueberschrieben");

    await importBoard(dir, FIXTURE_V2_ZIP, { force: true });

    const db = openDb(getBoardPaths(dir).dbPath);
    const taskCount = (db.query("SELECT COUNT(*) as c FROM tasks").get() as { c: number }).c;
    expect(taskCount).toBe(44);
    db.close();
  });
});
