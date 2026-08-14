// Tests fuer watchBoardChanges (watch-board.ts) -- Kanban-Task vfPIkirrvvm0,
// GitHub #43.
//
// Der Bug: Die TUI beobachtete `board.db` und sah fremde Aenderungen nie, weil
// ein fremder Prozess in den WAL schreibt und die Hauptdatei unberuehrt laesst
// (mtime und size unveraendert, Inode gleich).
//
// Wo es um genau diese Frage geht -- wird ein FREMDER Prozess gesehen --,
// schreibt der Test mit einem ECHTEN zweiten Prozess statt mit fs.writeFile:
// ein Schreibvorgang aus demselben Prozess reproduzierte den Bug nie. Wo es
// dagegen um das Verhalten des Watchers selbst geht (Entprellung, Filterregel),
// kommen die Ereignisse bewusst direkt aus dem Testprozess -- ein Subprozess
// wuerde dort nur Spawn-Latenz messen, siehe Kommentar am Entprell-Test.
import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initBoard, getBoardPaths } from "../src/core/db.ts";
import { watchBoardChanges, isBoardChange } from "../src/tui/watch-board.ts";
// loadData bleibt in use-board.ts -- der Regressionstest gegen das Flackern
// braucht es, weil erst das echte Lesen den Kreislauf entstehen laesst.
import { loadData } from "../src/tui/use-board.ts";

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
  //
  // Der Subprozess ist hier unverzichtbar -- und damit auch seine Latenz. Das
  // Zeitlimit ist deshalb bewusst weit (30 s statt der sonst ueblichen 15 s):
  // ein `bun run`-Spawn braucht auf einer ruhigen Maschine rund 260 ms, unter
  // Last aber auch mal 9 Sekunden, und mit 15 s lief der Test dann in seinen
  // eigenen Timeout statt eine Aussage zu treffen. Das Limit soll den Watcher
  // pruefen, nicht die Auslastung der Maschine.
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
  }, 30000);

  // Bewusst OHNE Subprozess -- anders als der Test darueber, und das ist der
  // Punkt. Dieser Test prueft nur die Entprellung, also die Frage "mehrere
  // Ereignisse, ein Reload". Dass ein fremder Prozess ueberhaupt gesehen wird,
  // ist Sache des Tests darueber; dort ist der echte Prozess unverzichtbar.
  //
  // Frueher spawnte auch dieser Test ein `kanban add`, und genau daran hing er:
  // Unter Last dauert so ein Spawn statt 260 ms auch mal 8,8 Sekunden (gemessen
  // bei Systemlast 19). Der Schreibvorgang zerfaellt dann in weit
  // auseinanderliegende Phasen, es entstehen zwei Entprell-Fenster, und der Test
  // sah calls=2. Das war kein Fehler im Watcher: dauert ein fremder
  // Schreibvorgang neun Sekunden, sind zwei Reloads richtig. Der Test mass die
  // Spawn-Latenz der Maschine, nicht die Entprellung.
  //
  // Die kleinen Pausen zwischen den Schreibvorgaengen sind noetig, nicht
  // kosmetisch: Ohne sie fasst macOS die drei Schreibvorgaenge zu einem
  // einzigen Ereignis zusammen, und der Test waere auch dann gruen, wenn die
  // Entprellung ganz fehlte. Nachgemessen -- 3x schreiben mit 25 ms Abstand
  // ergibt ohne Entprellung 3 Reloads, mit Entprellung 1. Das Fenster ist mit
  // 1000 ms weit genug, dass die drei Ereignisse auch unter Last hineinfallen,
  // ohne dass der Test von der Genauigkeit des Schedulers abhaengt.
  test("entprellt: mehrere Ereignisse in Folge loesen genau einen Reload aus", async () => {
    const { kanbanDir } = board();
    let calls = 0;
    stops.push(watchBoardChanges(kanbanDir, () => { calls++; }, 1000));
    await sleep(150);
    calls = 0;

    const wal = join(kanbanDir, "board.db-wal");
    for (let i = 0; i < 3; i++) {
      writeFileSync(wal, `schreibvorgang-${i}`);
      await sleep(25);
    }
    await sleep(2000);

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

  // Der Regressionstest gegen das Flackern: Ein reiner Lesevorgang oeffnet und
  // schliesst die DB und fasst dabei `board.db-shm` an. Zaehlte der Watcher das
  // als Aenderung, loeste jeder Reload den naechsten aus -- gemessen 49 Reloads
  // in 3 Sekunden, ohne dass irgendjemand etwas geschrieben haette.
  //
  // Bewusst mit dem echten loadData() als Callback statt mit einem Zaehler
  // allein: Der Kreislauf entsteht erst dadurch, DASS der Callback liest. Ein
  // Test, der nur zaehlt, wuerde ihn nie reproduzieren.
  test("ein Reload loest keinen weiteren Reload aus", async () => {
    const { dir, kanbanDir } = board();
    let calls = 0;
    stops.push(watchBoardChanges(kanbanDir, () => { calls++; loadData(dir); }, 20));
    await sleep(300);
    calls = 0;

    loadData(dir); // ein einziger Anstoss -- danach passiert nichts von aussen
    await sleep(1500);

    // Genau ein Reload ist erlaubt, und zwar aus einem benannten Grund: Fehlen
    // `board.db-wal` und `board.db-shm` noch (kalter Zustand -- erster Start,
    // oder nach einem sauberen Checkpoint), legt der erste Lesevorgang beide an
    // und laesst dabei auch den WAL feuern. Der daraus folgende Reload liest
    // warm und beruehrt nur noch den Index, den wir ignorieren -- es
    // konvergiert nach einem Zyklus. Was hier NICHT stehen darf, ist eine
    // Kette, die sich selbst traegt: mit dem Fehler stand hier eine
    // zweistellige Zahl.
    expect(calls).toBeLessThanOrEqual(1);
  }, 15000);

  describe("isBoardChange", () => {
    test("die Datenbank und ihr WAL zaehlen als Aenderung", () => {
      expect(isBoardChange("board.db")).toBe(true);
      expect(isBoardChange("board.db-wal")).toBe(true);
    });

    // Der Kern des Fixes -- der WAL-Index meldet nur, dass jemand gelesen hat.
    test("der WAL-Index zaehlt nicht als Aenderung", () => {
      expect(isBoardChange("board.db-shm")).toBe(false);
    });

    test("fremde Dateien zaehlen nicht als Aenderung", () => {
      expect(isBoardChange("config.json")).toBe(false);
      expect(isBoardChange("notes")).toBe(false);
    });

    // Ohne Dateinamen im Zweifel neu laden: ein ueberzaehliger Reload ist
    // harmlos, ein verpasster kostet dem Nutzer das Vertrauen in die Anzeige.
    // `fs.watch` liefert `string | null` -- mehr Faelle gibt es nicht.
    test("ohne Dateinamen wird im Zweifel neu geladen", () => {
      expect(isBoardChange(null)).toBe(true);
    });
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
