// CLI Command: kanban get — einzelnen Task per ID abrufen
import { Command } from "commander";
import { getContext } from "../context.ts";
import { formatTask, error } from "../formatters.ts";

export const getCommand = new Command("get")
  .description("Einzelnen Task per ID abrufen")
  .argument("<id>", "Task-ID (kann gekuerzt sein)")
  .option("--json", "Ausgabe als JSON")
  .action((id, options) => {
    const { taskService } = getContext();
    const task = taskService.getTask(id);

    if (!task) {
      if (options.json) {
        console.log("null");
      } else {
        error(`Task '${id}' nicht gefunden.`);
      }
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify(task));
    } else {
      console.log("\n  " + formatTask(task));
      if (task.description) {
        console.log(`  Beschreibung: ${task.description}`);
      }
      if (task.hasNotes) {
        console.log("  [Hat Notizen]");
      }
      console.log();
    }
  });
