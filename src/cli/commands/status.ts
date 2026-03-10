// CLI Command: kanban status
import { Command } from "commander";
import { getContext } from "../context.ts";
import { formatStatus } from "../formatters.ts";

export const statusCommand = new Command("status")
  .description("Board-Uebersicht anzeigen")
  .action(() => {
    const { taskService, config } = getContext();
    const status = taskService.getStatus();
    console.log();
    console.log(formatStatus(config.name, status.columns, status.total));
    console.log();
  });
