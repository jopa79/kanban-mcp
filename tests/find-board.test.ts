// Tests fuer die Aufwaertssuche der Board-Auffindung (P3-2).
// Kanban-Task dO8RX5y58h_8, GitHub #30, Plan Abschnitt 5.4/5.5.
//
// Die Abgrenzung ist der eigentliche Gegenstand dieses Tasks, nicht nur die
// Funktion selbst: CLI und TUI duerfen aufwaerts suchen, MCP-Server und
// 'kanban sync' NICHT (Isolationsgrenze zwischen Projekten bzw. E-2). Die
// drei Abgrenzungs-Tests unten (CLI findet, MCP findet nicht, sync schreibt
// nicht ins Elternboard) sind deshalb genauso wichtig wie die fuenf
// Kernfaelle von findBoardUpwards() selbst.
import { test, expect, describe, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initBoard, findBoardUpwards, boardExists } from "../src/core/db.ts";
import { getContext as getCliContext } from "../src/cli/context.ts";
import { withContext as withMcpContext } from "../src/mcp/mcp-context.ts";
import { createTestBoard, type TestContext } from "./helpers.ts";

describe("findBoardUpwards", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("findet ein Board im Elternverzeichnis aus einem verschachtelten Unterordner", () => {
    dir = mkdtempSync(join(tmpdir(), "kanban-upward-"));
    initBoard(dir, "Parent Board");
    const subDir = join(dir, "a", "b", "c");
    mkdirSync(subDir, { recursive: true });

    expect(findBoardUpwards(subDir)).toBe(dir);
  });

  test(".git im Elternverzeichnis ohne Board stoppt die Suche dort -- null", () => {
    dir = mkdtempSync(join(tmpdir(), "kanban-upward-"));
    mkdirSync(join(dir, ".git"));
    const subDir = join(dir, "sub");
    mkdirSync(subDir, { recursive: true });

    expect(findBoardUpwards(subDir)).toBeNull();
  });

  test("ein Board oberhalb der .git-Grenze wird NICHT gefunden", () => {
    dir = mkdtempSync(join(tmpdir(), "kanban-upward-"));
    initBoard(dir, "Grandparent Board"); // Board liegt OBERHALB der Git-Grenze
    const projectRoot = join(dir, "project");
    mkdirSync(join(projectRoot, ".git"), { recursive: true }); // Grenze, selbst ohne Board
    const subDir = join(projectRoot, "src", "core");
    mkdirSync(subDir, { recursive: true });

    expect(findBoardUpwards(subDir)).toBeNull();
  });

  test(
    "kein Board irgendwo -- null, keine Endlosschleife bis zum Dateisystem-Root",
    () => {
      dir = mkdtempSync(join(tmpdir(), "kanban-upward-"));
      const subDir = join(dir, "x", "y", "z");
      mkdirSync(subDir, { recursive: true });

      expect(findBoardUpwards(subDir)).toBeNull();
    },
    2000, // Zeitlimit macht eine Regression zur Endlosschleife im Testlauf sichtbar statt ihn haengen zu lassen
  );

  test("Verzeichnis ohne .git und ohne Board terminiert am Root", () => {
    dir = mkdtempSync(join(tmpdir(), "kanban-upward-"));

    expect(findBoardUpwards(dir)).toBeNull();
  });
});

describe("Abgrenzung 1/3: CLI sucht aufwaerts (getContext)", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("getContext() findet das Board aus einem verschachtelten Unterordner", () => {
    dir = mkdtempSync(join(tmpdir(), "kanban-cli-upward-"));
    initBoard(dir, "CLI Board");
    const subDir = join(dir, "src", "core");
    mkdirSync(subDir, { recursive: true });

    const ctx = getCliContext(subDir);
    expect(ctx.config.name).toBe("CLI Board");
  });
});

describe("Abgrenzung 2/3: MCP-Server bleibt exakt (Isolationsgrenze)", () => {
  let dir: string;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test("withContext() findet das Board NICHT aus einem Unterordner, obwohl das Elternverzeichnis eins hat", () => {
    dir = mkdtempSync(join(tmpdir(), "kanban-mcp-upward-"));
    initBoard(dir, "MCP Board");
    const subDir = join(dir, "sub");
    mkdirSync(subDir, { recursive: true });

    expect(() => withMcpContext(subDir, (ctx) => ctx.taskService.listTasks({}))).toThrow(
      "Kein Board gefunden",
    );
  });
});

describe("Abgrenzung 3/3: kanban sync bleibt exakt (E-2)", () => {
  let ctx: TestContext;
  afterEach(() => ctx?.cleanup());

  test("cwd in einem Unterordner ohne eigenes Board schreibt NICHTS ins Elternboard", () => {
    ctx = createTestBoard("Sync Parent Board");
    const beforeCount = ctx.taskService.listTasks().length;

    const subDir = join(ctx.dir, "worktree", "sub");
    mkdirSync(subDir, { recursive: true });

    const payload = JSON.stringify({
      cwd: subDir,
      tool_input: {
        todos: [{ content: "Darf nirgends landen", status: "pending", activeForm: "" }],
      },
    });

    const entrypoint = join(import.meta.dir, "..", "src", "index.ts");
    const result = Bun.spawnSync({
      cmd: ["bun", entrypoint, "sync"],
      cwd: subDir,
      stdin: Buffer.from(payload),
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);

    // Elternboard unveraendert -- kein neuer Task, insbesondere nicht der Todo-Titel
    const afterTasks = ctx.taskService.listTasks();
    expect(afterTasks.length).toBe(beforeCount);
    expect(afterTasks.some((t) => t.title === "Darf nirgends landen")).toBe(false);

    // sync legt auch kein eigenes Board im Unterordner an
    expect(boardExists(subDir)).toBe(false);
  });
});
