// Tests fuer watchBoardChanges (use-board.ts) -- Kanban-Task vfPIkirrvvm0,
// GitHub #43.
//
// Der Bug: Die TUI beobachtete `board.db` und sah fremde Aenderungen nie, weil
// ein fremder Prozess in den WAL schreibt und die Hauptdatei unberuehrt laesst
// (mtime und size unveraendert, Inode gleich). Diese Tests schreiben deshalb
// mit einem ECHTEN zweiten Prozess, nicht mit fs.writeFile -- ein Schreibvorgang
// aus demselben Prozess loeste die Warnung nie aus und wuerde den Bug nicht
// reproduzieren.
import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initBoard, getBoardPaths } from "../src/core/db.ts";
import { watchBoardChanges } from "../src/tui/use-board.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("watchBoardChanges", () => {
  const dirs: string[] = [];
  const stops: Array<() => void> = [];

  afterEach(() => {
    stops.forEach((s) => s());
    stops.length = 0;
    dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
    dirs.length = 0;
  });

  function board(): { dir: string; kanbanDir: string } {
    const dir = mkdtempSync(join(tmpdir(), "watch-board-test-"));
    dirs.push(dir);
    initBoard(dir, "Watch Test");
    return { dir, kanbanDir: getBoardPaths(dir).kanbanDir };
  }

  // Der eigentliche Regressionstest: ein anderer Prozess schreibt, die TUI muss
  // es mitbekommen. Mit dem alten watch(board.db) schlaegt er fehl.
  test("meldet den Schreibvorgang eines fremden Prozesses", async () => {
    const { dir, kanbanDir } = board();
    let calls = 0;
    stops.push(watchBoardChanges(kanbanDir, () => { calls++; }, 20));
    await sleep(150);
    calls = 0;

    const proc = Bun.spawn(
      ["bun", "run", join(import.meta.dir, "..", "src/index.ts"), "add", "Fremd", "--by", "fremd"],
      { cwd: dir, stdout: "ignore", stderr: "ignore" },
    );
    expect(await proc.exited).toBe(0);
    await sleep(600);

    expect(calls).toBeGreaterThan(0);
  }, 15000);

  // Bewusst mit einem grosszuegigen Entprell-Fenster (300 ms statt der 50 ms aus
  // dem Produktivpfad): Die zwei Ereignisse eines Schreibvorgangs liegen dann
  // sicher darin, auch wenn die Maschine unter Last steht. Mit 50 ms war der
  // Test von der Systemlast abhaengig und einmal fehlgeschlagen. Die Aussage
  // bleibt dieselbe -- ein Schreibvorgang, ein Reload --, sie haengt nur nicht
  // mehr am Scheduler.
  test("entprellt: ein Schreibvorgang loest genau einen Reload aus", async () => {
    const { dir, kanbanDir } = board();
    let calls = 0;
    stops.push(watchBoardChanges(kanbanDir, () => { calls++; }, 300));
    await sleep(150);
    calls = 0;

    const proc = Bun.spawn(
      ["bun", "run", join(import.meta.dir, "..", "src/index.ts"), "add", "Fremd", "--by", "fremd"],
      { cwd: dir, stdout: "ignore", stderr: "ignore" },
    );
    await proc.exited;
    await sleep(1200);

    expect(calls).toBe(1);
  }, 15000);

  test("ignoriert Dateien, die nicht zum Board gehoeren", async () => {
    const { kanbanDir } = board();
    let calls = 0;
    stops.push(watchBoardChanges(kanbanDir, () => { calls++; }, 20));
    await sleep(150);
    calls = 0;

    writeFileSync(join(kanbanDir, "irgendwas.txt"), "hallo");
    await sleep(300);

    expect(calls).toBe(0);
  });

  test("die Abmelde-Funktion stoppt weitere Meldungen", async () => {
    const { kanbanDir } = board();
    let calls = 0;
    const stop = watchBoardChanges(kanbanDir, () => { calls++; }, 20);
    await sleep(150);
    calls = 0; // Ereignisse aus dem Board-Setup nicht mitzaehlen
    stop();

    writeFileSync(join(kanbanDir, "board.db-wal"), "x");
    await sleep(300);

    expect(calls).toBe(0);
  });

  // Ein fehlendes Verzeichnis darf die TUI nicht mitreissen -- ohne Watch
  // laeuft sie weiter, nur ohne Auto-Refresh.
  test("wirft nicht, wenn das Verzeichnis fehlt", () => {
    const missing = join(tmpdir(), "gibt-es-nicht-" + process.pid);
    let stop: () => void = () => {};
    expect(() => { stop = watchBoardChanges(missing, () => {}); }).not.toThrow();
    expect(() => stop()).not.toThrow();
  });
});
