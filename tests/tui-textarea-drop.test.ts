// Regressionstest fuer verschluckte Zeichen im Notizen-Editor (GitHub #50,
// Plan .claude/plans/tui-input-flicker.md Schritt 3). Gleiches Muster wie
// tests/tui-input-drop.test.ts, hier im Modus 'edit-notes' -- tippt mit 5ms
// Abstand in den Multi-Line-Editor und erwartet den vollstaendigen Text.
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

test("kein Zeichenverlust im Notizen-Editor bei 5ms Tastenabstand", async () => {
  ctx = createTestBoard();
  addTaskInColumn(ctx, "Testtask", "todo");
  const stdin = new FakeStdin();
  const stdout = new FakeStdout();

  // Kein incrementalRendering: dieser Test prueft Zeichen-Korrektheit, nicht
  // das Flackern (siehe tui-render.test.ts). Ohne incrementalRendering
  // schreibt Ink bei jeder Aenderung einen vollen Frame, den die FakeStdout
  // zuverlaessig als letzten vollstaendigen Bildschirminhalt einfangen kann.
  const instance = render(React.createElement(App, { workingDir: ctx.dir }), {
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stdout as any,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(300);
  stdin.push("\r"); // Enter -- Detailansicht des ersten Tasks in Todo
  await sleep(150);
  stdin.push("e"); // Notizen editieren
  await sleep(150);

  const text = "Notiz mit vielen Zeichen zum Testen";
  for (const ch of text) {
    stdin.push(ch);
    await sleep(5);
  }
  await sleep(300);

  const plain = stripAnsi(stdout.lastChunk);
  // text-area.tsx numeriert Zeilen mit padStart(2) + einem Leerzeichen --
  // "Notiz..." liegt in Zeile 1, formatiert als " 1 <Text>". Die Zeile
  // beginnt zusaetzlich mit dem Box-Rahmenzeichen "│", deshalb ohne '^'-Anker
  // suchen. " 1 " ist eindeutiger als eine Teilzeichenkette aus dem
  // getippten Text (die z.B. in einer Task-ID zufaellig wieder auftauchen
  // kann). Rechter Rahmen + Fuellzeichen danach wieder abschneiden.
  const noteLine = plain.split("\n").find((l) => l.includes(" 1 ")) ?? "";
  const afterMarker = noteLine.split(" 1 ").slice(1).join(" 1 ");
  const shown = afterMarker.split("│")[0]!.trimEnd();

  instance.unmount();

  expect(shown).toBe(text);
});
