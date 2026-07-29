// CLI Command: kanban done
import { Command } from "commander";
import { getContext } from "../context.ts";
import { formatTask, success, error } from "../formatters.ts";

export const doneCommand = new Command("done")
  .description("Task als erledigt markieren")
  .argument("<id>", "Task-ID (kann gekuerzt sein)")
  .option("--by <name>", "Wer meldet diese Aenderung (default: user)")
  .action((id: string, options) => {
    try {
      const { taskService } = getContext();
      const task = taskService.completeTask(id, { reportedBy: options.by });
      success("Task erledigt:");
      console.log("  " + formatTask(task));
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });
