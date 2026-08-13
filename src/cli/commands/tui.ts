// CLI Command: kanban tui
import { Command } from "commander";
import React from "react";
import { render } from "ink";
import { App } from "../../tui/app.tsx";
import { findBoardUpwards, getBoardPaths, openDb } from "../../core/db.ts";
import { error } from "../formatters.ts";

// Ob dieser Prozess ein interaktives Terminal (TTY) auf stdin hat. Ink prueft
// beim Mounten exakt dasselbe Feld, um zu entscheiden, ob Raw-Mode moeglich
// ist (node_modules/ink/build/components/App.js: `isRawModeSupported =
// stdin.isTTY`). Reine Funktion (kein `process` direkt), damit sie ohne
// Mocking testbar ist -- Konvention im Repo, siehe formatters.test.ts.
export function isTtyAvailable(stdin: { isTTY?: boolean }): boolean {
  return Boolean(stdin.isTTY);
}

// Meldung bei fehlendem TTY. Eigene Konstante statt Inline-String, damit der
// Test denselben Text prueft, den Nutzer/Agents tatsaechlich sehen.
export const NO_TTY_MESSAGE =
  "Kein interaktives Terminal (TTY) gefunden -- die TUI braucht eins fuer " +
  "Tastatureingaben. Ohne TTY (z.B. Pipe, Skript, Agent) bitte die " +
  "CLI-Befehle nutzen: 'kanban --help'.";

export const tuiCommand = new Command("tui")
  .alias("ui")
  .description("Interaktive Terminal-UI starten")
  .action(() => {
    // Vorab-Check statt Absturz in Ink/React (Kanban-Task DUFjVlN6vOE-,
    // GitHub #37): ohne TTY wirft Inks useInput() synchron aus einem
    // React-Passive-Effect ("Raw mode is not supported ..."). Ink faengt das
    // selbst per ErrorBoundary ab, aber deren ErrorOverview verwendet dabei
    // rohe Stacktrace-Zeilen als React-Key (node_modules/ink/build/
    // components/ErrorOverview.js) -- bei einer rekursiven Reconciler-
    // Funktion wie recursivelyTraversePassiveMountEffects taucht dieselbe
    // Zeile mehrfach im Stack auf, was zu Reacts "duplicate key"-Warnung
    // fuehrt. Root Cause ist die Ink-Bibliothek (reproduziert mit einem
    // Minimalfall ganz ohne kanban-mcp-Code), nicht diese Codebase -- wir
    // vermeiden den kaputten Pfad frueh, statt ihn zu flicken oder Ink zu
    // patchen.
    if (!isTtyAvailable(process.stdin)) {
      error(NO_TTY_MESSAGE);
      process.exit(1);
    }

    // Aufwaertssuche (P3-2, Plan Abschnitt 5.4): die TUI darf, wie die CLI,
    // aus einem Unterverzeichnis gestartet werden. 'workingDir' zeigt danach
    // exakt auf das gefundene Board-Verzeichnis -- use-board.ts/app.tsx
    // bekommen weiterhin einen bereits aufgeloesten, exakten Pfad und bleiben
    // unveraendert (deren eigener boardExists()-Check in app.tsx bleibt
    // damit korrekt exakt).
    const workingDir = findBoardUpwards(process.cwd());

    // Vorab-Check statt Absturz in Ink/React: 'kein Board' oder eine
    // veraltete Schema-Version (P0-5-Guard in openDb()) sollen eine
    // formatierte Meldung liefern, bevor die TUI ueberhaupt rendert — analog
    // zu getContext() in context.ts (gleiche Aufrufstelle laut Plan: "CLI +
    // TUI"). use-board.ts oeffnet die DB danach fuer den eigentlichen Betrieb
    // selbst noch einmal; das anzufassen ist ein eigener Task (#35).
    if (workingDir === null) {
      error("Kein Board gefunden. Zuerst 'kanban init' ausfuehren.");
      process.exit(1);
    }
    try {
      openDb(getBoardPaths(workingDir).dbPath).close();
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }

    render(React.createElement(App, { workingDir }));
  });
