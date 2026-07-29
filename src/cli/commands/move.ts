// CLI Command: kanban move
import { Command } from "commander";
import { getContext } from "../context.ts";
import { formatTask, success, error } from "../formatters.ts";

export const moveCommand = new Command("move")
  .alias("mv")
  .description("Task in andere Spalte verschieben")
  .argument("<id>", "Task-ID (kann gekuerzt sein)")
  .argument("<column>", "Ziel-Spalte (z.B. in-progress, review, done)")
  .option("--by <name>", "Wer meldet diese Aenderung (default: user)")
  .action((id: string, column: string, options) => {
    try {
      const { taskService } = getContext();
      const task = taskService.moveTask(id, column, { reportedBy: options.by });
      success("Task verschoben:");
      console.log("  " + formatTask(task));
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });
