// Regressionstest fuer verschluckte/vertauschte Zeichen beim Tippen
// (GitHub #50, Plan .claude/plans/tui-input-flicker.md Schritt 2).
//
// Vor der Umstellung auf LineInput lag der Eingabewert in app.tsx, jeder
// Tastendruck renderte damit das gesamte Board (gemessen 9ms Schnitt, 23ms
// max). Weil Inks useInput() seinen Handler in einem useEffect mit dem
// Handler selbst als Dependency registriert, lief bei schnellem Tippen noch
// der ALTE Handler mit dem ALTEN Prop-Wert -- gemessen ab 15ms Tastenabstand
// wurden Zeichen verschluckt oder vertauscht (27 Zeichen bei 15ms Abstand:
// nur 24 kamen an). Dieser Test tippt mit 5ms Abstand -- enger als die
// gemessene Grenze -- und erwartet trotzdem den vollstaendigen Text.
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
  rows = 45;
  columns = 220;
  lastChunk = "";
  override _write(chunk: Buffer, _enc: string, cb: () => void) {
    const s = chunk.toString();
    if (s.length > 200) this.lastChunk = s;
    cb();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

let ctx: TestContext | undefined;
afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
});

test("kein Zeichenverlust bei 5ms Tastenabstand (Neuer Task)", async () => {
  ctx = createTestBoard();
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();

  // Kein incrementalRendering hier: dieser Test prueft Zeichen-Korrektheit,
  // nicht das Flackern (siehe tui-render.test.ts fuer Schritt 1). Ohne
  // incrementalRendering schreibt Ink bei jeder Aenderung einen vollen Frame
  // -- die FakeStdout kann so zuverlaessig den letzten vollstaendigen
  // Bildschirminhalt einfangen, statt relative Zeilen-Diffs zusammensetzen
  // zu muessen.
  const instance = render(React.createElement(App, { workingDir: ctx.dir }), {
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stdout as any,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(300);
  stdin.push("n");
  await sleep(150);

  const text = "Hallo Welt das ist ein Test";
  for (const ch of text) {
    stdin.push(ch);
    await sleep(5);
  }
  await sleep(300);

  const plain = stripAnsi(stdout.lastChunk);
  const line = plain.split("\n").find((l) => l.includes("Neuer Task:")) ?? "";
  const shown = line
    .replace(/.*Neuer Task: /, "")
    .replace(/\s+\(Esc=Abbrechen\).*/, "")
    .trim();

  stdin.push("\x1b");
  await sleep(100);
  instance.unmount();

  expect(shown).toBe(text);
});

test("Enter direkt nach der letzten Taste sendet den vollstaendigen Wert ab", async () => {
  ctx = createTestBoard();
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();

  const instance = render(React.createElement(App, { workingDir: ctx.dir }), {
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stdout as any,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(300);
  stdin.push("n");
  await sleep(150);

  const text = "Schnell";
  for (const ch of text) {
    stdin.push(ch);
    await sleep(5);
  }
  stdin.push("\r"); // Enter ohne Pause direkt nach dem letzten Zeichen
  await sleep(300);

  instance.unmount();

  const created = ctx.taskService.listTasks({});
  const titles = created.map((t) => t.title);
  expect(titles).toContain(text);
});
