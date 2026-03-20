// CLI Command: kanban status
import { Command } from "commander";
import { getContext } from "../context.ts";
import { formatStatus } from "../formatters.ts";

export const statusCommand = new Command("status")
  .description("Board-Uebersicht anzeigen")
  .option("--json", "Ausgabe als JSON")
  .action((options) => {
    const { taskService, config } = getContext();
    const status = taskService.getStatus();

    // JSON-Ausgabe: Status-Objekt mit Board-Name
    if (options.json) {
      console.log(JSON.stringify({ board: config.name, ...status }));
      return;
    }

    console.log();
    console.log(formatStatus(config.name, status.columns, status.total));
    console.log();
  });
