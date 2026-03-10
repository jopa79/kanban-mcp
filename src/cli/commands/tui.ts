// CLI Command: kanban tui
import { Command } from "commander";
import React from "react";
import { render } from "ink";
import { App } from "../../tui/app.tsx";

export const tuiCommand = new Command("tui")
  .alias("ui")
  .description("Interaktive Terminal-UI starten")
  .action(() => {
    const workingDir = process.cwd();
    render(React.createElement(App, { workingDir }), { fullScreen: true });
  });
