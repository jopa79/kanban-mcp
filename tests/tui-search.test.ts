// Mount-Regressionstests fuer den Sprung-Suchmodus (Taste "g", GitHub #51,
// Plan .claude/plans/tui-search-jump.md, Schritt T4). SearchResultList
// (reine Darstellung) deckt tests/search-view.test.tsx per renderToString()
// ab -- diese Datei mountet die echte <App> gegen ein Fake-TTY (Muster:
// tests/tui-input-drop.test.ts fuer FakeStdin/Tastatur-Simulation,
// tests/tui-render.test.ts fuer den Flacker-Test mit incrementalRendering).
//
// SearchView haelt State und eine eigene vollstaendige useInput()-Kaskade --
// nur ueber einen echten Ink-Mount pruefbar, nicht per renderToString().
import { test, expect, afterEach } from "bun:test";
import React from "react";
import { render } from "ink";
import { Readable, Writable } from "node:stream";
import { App } from "../src/tui/app.tsx";
import { createTestBoard, addTaskInColumn, type TestContext } from "./helpers.ts";

// Wort, das NUR in der Notiz steht, nicht im Titel -- Test 3 prueft, dass
// der Suchindex tatsaechlich Notizen einliest (Plan Abschnitt 2.1), nicht
// nur Titel/Beschreibung/ID.
const NOTE_ONLY_WORD = "Zeppelin";

// Gemeinsamer Praefix aller Ueberlauf-Fixture-Tasks in Test 8 -- absichtlich
// mit "z" beginnend, damit KEIN anderer Fixture-Titel (Alpha/Beta/Gamma Task)
// versehentlich mittrifft.
const OVERFLOW_TITLE_PREFIX = "zzzfiller";
// Muss die "SEARCH_LAYOUT_OVERHEAD"-Konstante aus search-view.tsx (6) bei
// FakeStdout.rows=24 uebersteigen (maxVisible = 24 - 6 = 18), sonst testet
// Test 8 nichts -- die Trefferliste muss tatsaechlich voll/ueberlaufend sein
// (Plan Abschnitt "T4: Mount-Regressionstests").
const OVERFLOW_TASK_COUNT = 20;

class FakeStdin extends Readable {
  isTTY = true;
  setRawMode() {}
  ref() {}
  unref() {}
  override _read() {}
}

// Fuer Tests 1-7 und den Isolations-Test: kein incrementalRendering, damit
// der letzte VOLLE Frame lesbar bleibt (Muster: tui-input-drop.test.ts).
class FakeStdoutFullFrame extends Writable {
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

// Fuer Test 8 (Flacker-Schutz): sammelt ALLE geschriebenen Chunks mit
// incrementalRendering, feste 'rows' (Muster: tui-render.test.ts).
class FakeStdoutChunks extends Writable {
  isTTY = true;
  columns = 220;
  chunks: string[] = [];
  constructor(public rows = 24) {
    super();
  }
  override _write(chunk: Buffer, _enc: string, cb: () => void) {
    this.chunks.push(chunk.toString());
    cb();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

// Zieht die Kopfzeile "KANBAN | <Spalte>" aus dem vollen Frame -- die
// einzige Zeile, die "KANBAN" enthaelt (app.tsx). Robuster als eine blosse
// Suche nach dem Spaltennamen im gesamten Frame: die Board-Ansicht zeigt
// ALLE Spaltennamen als Kartenspalten-Header, unabhaengig vom Cursor.
function headerLine(plain: string): string {
  return plain.split("\n").find((l) => l.includes("KANBAN")) ?? "";
}

// Baut das Standard-Fixture-Board fuer die Tests 1-7 und den
// Isolations-Test: drei Tasks in unterschiedlichen Spalten, einer mit
// Notiz (Test 3), einer mit Faelligkeitsdatum (Test 4).
function buildFixtureBoard(): { ctx: TestContext; withNote: ReturnType<typeof addTaskInColumn>; withDue: ReturnType<typeof addTaskInColumn> } {
  const ctx = createTestBoard();
  addTaskInColumn(ctx, "Alpha Task", "todo");
  const withNote = addTaskInColumn(ctx, "Beta Task", "in-progress");
  ctx.notesService.save(withNote.id, `Enthaelt das Schluesselwort ${NOTE_ONLY_WORD} exklusiv.`);
  const withDue = addTaskInColumn(ctx, "Gamma Task", "done");
  ctx.taskService.updateTask(withDue.id, { dueDate: "2026-09-03" });
  return { ctx, withNote, withDue };
}

let ctx: TestContext | undefined;
afterEach(() => {
  ctx?.cleanup();
  ctx = undefined;
});

test("'g' oeffnet die Suche", async () => {
  const fixture = buildFixtureBoard();
  ctx = fixture.ctx;
  const stdin = new FakeStdin();
  const stdout = new FakeStdoutFullFrame();

  const instance = render(React.createElement(App, { workingDir: ctx.dir }), {
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stdout as any,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(300);
  stdin.push("g");
  await sleep(200);
  instance.unmount();

  const plain = stripAnsi(stdout.lastChunk);
  expect(plain).toContain("Suche");
});

test("Tippen mit 5ms Abstand: Treffer erscheint, Eingabezeile vollstaendig", async () => {
  const fixture = buildFixtureBoard();
  ctx = fixture.ctx;
  const stdin = new FakeStdin();
  const stdout = new FakeStdoutFullFrame();

  const instance = render(React.createElement(App, { workingDir: ctx.dir }), {
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stdout as any,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(300);
  stdin.push("g");
  await sleep(150);

  const text = "Alpha";
  for (const ch of text) {
    stdin.push(ch);
    await sleep(5);
  }
  await sleep(300);
  instance.unmount();

  const plain = stripAnsi(stdout.lastChunk);
  expect(plain).toContain("Alpha Task");

  // Eingabezeile vollstaendig (Muster: tests/tui-input-drop.test.ts) -- die
  // Zeile "Suche: <Wert>" ist eindeutig, die separate Titelzeile "Suche"
  // (ohne Doppelpunkt) darf nicht mitgreifen.
  const line = plain.split("\n").find((l) => l.includes("Suche: ")) ?? "";
  const shown = line.replace(/.*Suche: /, "").trimEnd();
  expect(shown).toBe(text);
});

test("Treffer nur ueber Notiztext", async () => {
  const fixture = buildFixtureBoard();
  ctx = fixture.ctx;
  const stdin = new FakeStdin();
  const stdout = new FakeStdoutFullFrame();

  const instance = render(React.createElement(App, { workingDir: ctx.dir }), {
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stdout as any,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(300);
  stdin.push("g");
  await sleep(150);

  for (const ch of NOTE_ONLY_WORD) {
    stdin.push(ch);
    await sleep(5);
  }
  await sleep(300);
  instance.unmount();

  const plain = stripAnsi(stdout.lastChunk);
  // Treffer ist der Task mit der Notiz (Beta Task), nicht die anderen --
  // das Wort steht ausschliesslich in der Notiz, nicht im Titel.
  expect(plain).toContain("Beta Task");
  expect(plain).not.toContain("Alpha Task");
  expect(plain).not.toContain("Gamma Task");
});

test("'faellig:2026-09' zeigt nur den Task mit diesem Datum", async () => {
  const fixture = buildFixtureBoard();
  ctx = fixture.ctx;
  const stdin = new FakeStdin();
  const stdout = new FakeStdoutFullFrame();

  const instance = render(React.createElement(App, { workingDir: ctx.dir }), {
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stdout as any,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(300);
  stdin.push("g");
  await sleep(150);

  for (const ch of "faellig:2026-09") {
    stdin.push(ch);
    await sleep(5);
  }
  await sleep(300);
  instance.unmount();

  const plain = stripAnsi(stdout.lastChunk);
  expect(plain).toContain("Gamma Task");
  expect(plain).not.toContain("Alpha Task");
  expect(plain).not.toContain("Beta Task");
});

test("Enter: Header zeigt die Spalte des Treffers, Status zeigt 'Sprung:'", async () => {
  const fixture = buildFixtureBoard();
  ctx = fixture.ctx;
  const stdin = new FakeStdin();
  const stdout = new FakeStdoutFullFrame();

  const instance = render(React.createElement(App, { workingDir: ctx.dir }), {
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stdout as any,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(300);
  stdin.push("g");
  await sleep(150);

  // "Beta Task" liegt in "in-progress" -- eindeutiger Treffer.
  for (const ch of "Beta Task") {
    stdin.push(ch);
    await sleep(5);
  }
  await sleep(200);
  stdin.push("\r");
  await sleep(200);
  instance.unmount();

  const plain = stripAnsi(stdout.lastChunk);
  expect(headerLine(plain)).toContain("In Progress");
  expect(plain).toContain('Sprung: "Beta Task"');
});

test("Esc: Header zeigt weiter 'Todo', kein Statuswechsel", async () => {
  const fixture = buildFixtureBoard();
  ctx = fixture.ctx;
  const stdin = new FakeStdin();
  const stdout = new FakeStdoutFullFrame();

  const instance = render(React.createElement(App, { workingDir: ctx.dir }), {
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stdout as any,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(300);
  stdin.push("g");
  await sleep(150);
  for (const ch of "Beta") {
    stdin.push(ch);
    await sleep(5);
  }
  await sleep(150);
  stdin.push("\x1b");
  await sleep(200);
  instance.unmount();

  const plain = stripAnsi(stdout.lastChunk);
  // "Todo" ist die Ausgangsspalte (INITIAL_SELECTED_COLUMN = 1, app.tsx).
  expect(headerLine(plain)).toContain("Todo");
  expect(headerLine(plain)).not.toContain("In Progress");
  expect(plain).not.toContain("Sprung:");
});

test("Kein Treffer: 'Keine Treffer' im Frame", async () => {
  const fixture = buildFixtureBoard();
  ctx = fixture.ctx;
  const stdin = new FakeStdin();
  const stdout = new FakeStdoutFullFrame();

  const instance = render(React.createElement(App, { workingDir: ctx.dir }), {
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stdout as any,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(300);
  stdin.push("g");
  await sleep(150);
  for (const ch of "keintrefferimboard") {
    stdin.push(ch);
    await sleep(5);
  }
  await sleep(300);
  instance.unmount();

  const plain = stripAnsi(stdout.lastChunk);
  expect(plain).toContain("Keine Treffer");
});

// Blocker A aus vier Review-Runden (Plan Abschnitt 2.3 Punkt 1): erreicht
// die Suchansicht die Terminalhoehe, faellt Ink in seinen Vollbild-Pfad und
// schreibt bei jedem Tastendruck ESC[2J ESC[3J. Nur mit einer Trefferliste,
// die tatsaechlich VOLL/ueberlaufend ist (mehr Treffer als 'maxVisible' in
// search-view.tsx), testet dieser Fall etwas.
test("Flacker-Schutz: kein Terminal-Clear bei voller Trefferliste (rows: 24)", async () => {
  ctx = createTestBoard();
  addTaskInColumn(ctx, "Alpha Task", "todo");
  for (let i = 0; i < OVERFLOW_TASK_COUNT; i++) {
    ctx.taskService.addTask({ title: `${OVERFLOW_TITLE_PREFIX}-${i}` });
  }

  const stdin = new FakeStdin();
  const stdout = new FakeStdoutChunks(24);

  const instance = render(React.createElement(App, { workingDir: ctx.dir }), {
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stdout as any,
    exitOnCtrlC: false,
    patchConsole: false,
    incrementalRendering: true,
  });

  await sleep(300);
  stdout.chunks = []; // Mount-Frame separat, danach zaehlen wir sauber

  stdin.push("g"); // Suche oeffnen
  await sleep(150);

  // Sechs Zeichen, jedes Praefix ist bereits Substring aller
  // OVERFLOW_TITLE_PREFIX-Tasks -- die Trefferliste bleibt bei JEDEM
  // Tastendruck voll (OVERFLOW_TASK_COUNT=20 > maxVisible=18 bei rows=24).
  for (const ch of "zzzfil") {
    stdin.push(ch);
    await sleep(10);
  }
  await sleep(200);

  instance.unmount();

  const clears = stdout.chunks.filter((c) => c.includes("\x1b[2J"));
  expect(clears).toEqual([]);
});

// Regressionsabsicherung fuer den Doppel-Handler-Bug (Plan Abschnitt 2.3
// Punkt 2, siehe auch tests/tui-archive-picker-handler.test.ts): "search"
// steht bereits im Fruehausstieg-Block von use-input-modes.ts. Dieser Test
// haelt das regressionsfest -- Pfeil rechts wuerde im Board-Modus den
// Cursor eine Spalte weiterbewegen (Todo -> In Progress). Laeuft der
// globale Handler unter SearchView faelschlich mit, aendert sich die
// Spalte im Hintergrund, obwohl SearchView selbst kein Pfeil-links/rechts
// verarbeitet.
test("Suchmodus: globaler Board-Handler laeuft NICHT mit (Pfeil rechts aendert die Spalte nicht)", async () => {
  const fixture = buildFixtureBoard();
  ctx = fixture.ctx;
  const stdin = new FakeStdin();
  const stdout = new FakeStdoutFullFrame();

  const instance = render(React.createElement(App, { workingDir: ctx.dir }), {
    stdin: stdin as any,
    stdout: stdout as any,
    stderr: stdout as any,
    exitOnCtrlC: false,
    patchConsole: false,
  });

  await sleep(300);
  stdin.push("g"); // Suche oeffnen -- Startspalte ist "Todo"
  await sleep(150);
  stdin.push("\x1b[C"); // Pfeil rechts -- im Board-Modus wuerde das die Spalte wechseln
  await sleep(150);
  stdin.push("\x1b"); // Esc zurueck zum Board
  await sleep(200);
  instance.unmount();

  const plain = stripAnsi(stdout.lastChunk);
  expect(headerLine(plain)).toContain("Todo");
  expect(headerLine(plain)).not.toContain("In Progress");
});
