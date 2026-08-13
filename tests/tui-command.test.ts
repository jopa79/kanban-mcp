// Tests fuer 'kanban tui' (Kanban-Task DUFjVlN6vOE-, GitHub #37).
// Wie boards-command.test.ts / formatters.test.ts: die Command-Action selbst
// (console.log/process.exit, mountet Ink) bleibt ungetestet -- Konvention im
// Repo (siehe formatters.test.ts). Getestet wird nur die reine, exportierte
// Vorab-Pruefung isTtyAvailable(), die die Action VOR dem Ink-Mount aufruft.
//
// Hintergrund: ohne TTY kann Ink keinen Raw-Mode aktivieren. useInput() wirft
// dann synchron aus einem React-Passive-Effect heraus (node_modules/ink/build/
// components/App.js, handleSetRawMode). Inks eigene ErrorBoundary faengt das
// zwar ab, ihre ErrorOverview verwendet dabei aber rohe, nicht garantiert
// eindeutige Stacktrace-Zeilen als React-Key (node_modules/ink/build/
// components/ErrorOverview.js, `key={line}` bei error.stack.split('\n').map),
// was React auf die gemeldete "duplicate key"-Warnung bringt. Reproduziert
// mit einem Minimalfall (nur useInput + <Text>, kein kanban-mcp-Code) sowohl
// mit als auch ohne TTY -- die Warnung erscheint ausschliesslich ohne TTY.
// Root Cause ist die Ink-Bibliothek, nicht kanban-mcp; dieser Guard vermeidet
// den kaputten Pfad, statt ihn zu flicken.
import { test, expect, describe } from "bun:test";
import { isTtyAvailable, NO_TTY_MESSAGE } from "../src/cli/commands/tui.ts";

describe("isTtyAvailable", () => {
  test("TTY vorhanden -- true", () => {
    expect(isTtyAvailable({ isTTY: true })).toBe(true);
  });

  test("kein TTY (isTTY: false, z.B. umgeleitete Datei) -- false", () => {
    expect(isTtyAvailable({ isTTY: false })).toBe(false);
  });

  test("kein TTY (isTTY: undefined, der Normalfall bei Pipes/Agents/CI) -- false", () => {
    expect(isTtyAvailable({ isTTY: undefined })).toBe(false);
  });
});

describe("NO_TTY_MESSAGE", () => {
  test("erklaert das Problem (TTY) und nennt einen Ausweg (CLI-Hilfe)", () => {
    expect(NO_TTY_MESSAGE).toContain("TTY");
    expect(NO_TTY_MESSAGE).toContain("kanban --help");
  });
});
