// CLI Command: kanban delete
import { Command } from "commander";
import { getContext } from "../context.ts";
import { success, error } from "../formatters.ts";

export const deleteCommand = new Command("delete")
  .alias("rm")
  .description("Task loeschen")
  .argument("<id>", "Task-ID (kann gekuerzt sein)")
  .action((id: string) => {
    try {
      const { taskService } = getContext();

      // Task anzeigen bevor geloescht wird
      const task = taskService.getTask(id);
      if (!task) {
        error(`Task '${id}' nicht gefunden`);
        process.exit(1);
      }

      taskService.deleteTask(id);
      success(`Task '${task.title}' geloescht`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });
