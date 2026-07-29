// CLI Command: kanban tui
import { Command } from "commander";
import React from "react";
import { render } from "ink";
import { App } from "../../tui/app.tsx";
import { boardExists, getBoardPaths, openDb } from "../../core/db.ts";
import { error } from "../formatters.ts";

export const tuiCommand = new Command("tui")
  .alias("ui")
  .description("Interaktive Terminal-UI starten")
  .action(() => {
    const workingDir = process.cwd();

    // Vorab-Check statt Absturz in Ink/React: 'kein Board' oder eine
    // veraltete Schema-Version (P0-5-Guard in openDb()) sollen eine
    // formatierte Meldung liefern, bevor die TUI ueberhaupt rendert — analog
    // zu getContext() in context.ts (gleiche Aufrufstelle laut Plan: "CLI +
    // TUI"). use-board.ts oeffnet die DB danach fuer den eigentlichen Betrieb
    // selbst noch einmal; das anzufassen ist ein eigener Task (#35).
    if (!boardExists(workingDir)) {
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
