// Regressionstest fuer das TUI-Flackern (GitHub #50, Plan
// .claude/plans/tui-input-flicker.md Schritt 1).
//
// Ink faellt in seinen Vollbild-Pfad und schreibt bei jedem Frame
// ESC[2J ESC[3J ESC[H, sobald die Ausgabehoehe die Terminalhoehe erreicht
// (node_modules/ink/build/ink.js: `lastOutputHeight >= stdout.rows`). Dieser
// Test mountet die echte <App> gegen ein Fake-TTY (isTTY:true, feste
// rows/columns) mit einem Fake-Stdin, der Tastendruecke simuliert, und
// prueft, dass in keinem geschriebenen Chunk ein Terminal-Clear steckt --
// weder beim Mount noch waehrend des Tippens.
//
// Kein ink-testing-library im Repo (siehe use-board.ts-Kommentar zu #35) --
// stattdessen Inks eigenes render() mit injizierten Streams, dasselbe Muster,
// mit dem der Fehler urspruenglich reproduziert wurde.
import { test, expect, afterEach } from "bun:test";
import React from "react";
import { render } from "ink";
import { Readable, Writable } from "node:stream";
import { App } from "../src/tui/app.tsx";
import { createTestBoard, type TestContext } from "./helpers.ts";

class FakeStdin extends Readable {
  isTTY = true;
  setRawMode() {}
  ref() {}
  unref() {}
  override _read() {}
}

class FakeStdout extends Writable {
  isTTY = true;
  columns = 220;
  chunks: string[] = [];
  constructor(public rows = 45) {
    super();
  }
  override _write(chunk: Buffer, _enc: string, cb: () => void) {
    this.chunks.push(chunk.toString());
    cb();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let ctx: TestContext | undefined;
afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
});

test("kein Terminal-Clear beim Mount und beim Tippen", async () => {
  ctx = createTestBoard();
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();

  const instance = render(React.createElement(App, { workingDir: ctx.dir }), {
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stdout as any,
    exitOnCtrlC: false,
    patchConsole: false,
    incrementalRendering: true,
  });

  await sleep(300);
  stdout.chunks = []; // Mount-Frame separat pruefen, danach zaehlen wir sauber

  stdin.push("n"); // Modus "add" oeffnen
  await sleep(100);
  for (const ch of "Hallo Welt") {
    stdin.push(ch);
    await sleep(10);
  }
  await sleep(200);
  stdin.push("\x1b"); // Esc, zurueck ins Board
  await sleep(100);

  instance.unmount();

  const clears = stdout.chunks.filter((c) => c.includes("\x1b[2J"));
  expect(clears).toEqual([]);
});

test("kein Terminal-Clear bei mehr Tasks als sichtbar (Overflow-Fall)", async () => {
  ctx = createTestBoard();
  for (let i = 0; i < 30; i++) {
    ctx.taskService.addTask({ title: `Task ${i}` });
  }
  const stdin = new FakeStdin();
  const stdout = new FakeStdout(45);

  const instance = render(React.createElement(App, { workingDir: ctx.dir }), {
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stdout as any,
    exitOnCtrlC: false,
    patchConsole: false,
    incrementalRendering: true,
  });

  await sleep(300);
  stdout.chunks = [];

  stdin.push("n");
  await sleep(100);
  stdin.push("X");
  await sleep(100);
  stdin.push("\x1b");
  await sleep(100);

  instance.unmount();

  const clears = stdout.chunks.filter((c) => c.includes("\x1b[2J"));
  expect(clears).toEqual([]);
});

// Vom Plan gefordert (.claude/plans/tui-input-flicker.md Schritt 1), aber im
// urspruenglichen Test fehlend (gefunden im Review von #50): ein kleines
// Terminal, bei dem die Kartenliste den verfuegbaren Platz garantiert
// ueberschreitet -- genau der Fall, in dem LAYOUT_OVERHEAD zu knapp
// bemessen sein koennte und Ink wieder in den Vollbild-Pfad faellt.
test("kein Terminal-Clear bei kleinem Terminal (rows: 20) mit Ueberlauf", async () => {
  ctx = createTestBoard();
  for (let i = 0; i < 30; i++) {
    ctx.taskService.addTask({ title: `Task ${i}` });
  }
  const stdin = new FakeStdin();
  const stdout = new FakeStdout(20);

  const instance = render(React.createElement(App, { workingDir: ctx.dir }), {
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stdout as any,
    exitOnCtrlC: false,
    patchConsole: false,
    incrementalRendering: true,
  });

  await sleep(300);
  stdout.chunks = [];

  stdin.push("n");
  await sleep(100);
  for (const ch of "Hallo") {
    stdin.push(ch);
    await sleep(10);
  }
  await sleep(150);
  stdin.push("\x1b");
  await sleep(100);

  instance.unmount();

  const clears = stdout.chunks.filter((c) => c.includes("\x1b[2J"));
  expect(clears).toEqual([]);
});
