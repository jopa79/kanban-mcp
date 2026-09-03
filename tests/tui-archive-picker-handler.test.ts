// Regressionstest fuer den Doppel-Handler-Bug in Archiv- und
// Board-Auswahl-Modus (gefunden im Review von #50). use-input-modes.ts lief
// bisher auch in diesen Modi mit, weil "archive" und "board-picker" im
// Fruehausstieg fehlten -- ArchiveView/BoardPicker haben aber je ein
// eigenes, vollstaendiges useInput(). Folge: "q" im Archiv rief zusaetzlich
// exit() aus dem globalen Handler auf und beendete die ganze TUI, statt nur
// zum Board zurueckzugehen (archive-view.tsx ruft bei "q"/Esc onBack() auf).
import { test, expect, afterEach } from "bun:test";
import React from "react";
import { render } from "ink";
import { Readable, Writable } from "node:stream";
import { App } from "../src/tui/app.tsx";
import { createTestBoard, addTaskInColumn, type TestContext } from "./helpers.ts";

class FakeStdin extends Readable {
  isTTY = true;
  setRawMode() {}
  ref() {}
  unref() {}
  override _read() {}
}

class FakeStdout extends Writable {
  isTTY = true;
  rows = 45;
  columns = 220;
  override _write(_chunk: Buffer, _enc: string, cb: () => void) {
    cb();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let ctx: TestContext | undefined;
afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
});

test("'q' im Archiv beendet NICHT die TUI, sondern geht nur zum Board zurueck", async () => {
  ctx = createTestBoard();
  const task = addTaskInColumn(ctx, "Testtask", "todo");
  ctx.taskService.archiveTask(task.id);

  const stdin = new FakeStdin();
  const stdout = new FakeStdout();

  const instance = render(React.createElement(App, { workingDir: ctx.dir }), {
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stdout as any,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  let exited = false;
  instance.waitUntilExit().then(() => { exited = true; });

  await sleep(300);
  stdin.push("A"); // Archiv oeffnen
  await sleep(150);
  stdin.push("q"); // sollte NUR onBack() ausloesen, nicht exit()
  await sleep(200);

  expect(exited).toBe(false);

  instance.unmount();
});
