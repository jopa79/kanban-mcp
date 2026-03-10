// CLI Command: kanban add
import { Command } from "commander";
import { getContext } from "../context.ts";
import { formatTask, success, error } from "../formatters.ts";

export const addCommand = new Command("add")
  .description("Neuen Task hinzufuegen")
  .argument("<title>", "Task-Titel")
  .option("-c, --column <column>", "Spalte (default: todo)")
  .option("-d, --description <text>", "Beschreibung")
  .option("-a, --assignee <name>", "Zugewiesen an")
  .option("-l, --labels <labels>", "Labels (kommagetrennt)")
  .option("-n, --notes <text>", "Markdown-Notizen")
  .action((title: string, options) => {
    try {
      const { taskService } = getContext();
      const labels = options.labels
        ? options.labels.split(",").map((l: string) => l.trim())
        : undefined;

      const task = taskService.addTask({
        title,
        columnId: options.column,
        description: options.description,
        assignedTo: options.assignee,
        labels,
        notes: options.notes,
      });

      success("Task erstellt:");
      console.log("  " + formatTask(task));
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });
