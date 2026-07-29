// CLI Command: kanban update
// Fehlte bisher komplett (P2-2) -- ohne dieses Kommando liesse sich eine
// Prioritaet/Faelligkeit nachtraeglich nur ueber MCP oder TUI setzen.
import { Command } from "commander";
import { getContext } from "../context.ts";
import { formatTask, success, error } from "../formatters.ts";

export const updateCommand = new Command("update")
  .description("Task-Eigenschaften aendern")
  .argument("<id>", "Task-ID (kann gekuerzt sein)")
  .option("-t, --title <text>", "Neuer Titel")
  .option("-d, --description <text>", "Neue Beschreibung")
  .option("-a, --assignee <name>", "Neuer Assignee")
  .option("-l, --labels <labels>", "Neue Labels (kommagetrennt)")
  .option("-p, --priority <high|medium|low>", "Neue Prioritaet")
  .option("--due <YYYY-MM-DD>", "Neue Faelligkeit")
  .action((id: string, options) => {
    try {
      const { taskService } = getContext();
      const labels = options.labels
        ? options.labels.split(",").map((l: string) => l.trim())
        : undefined;

      const task = taskService.updateTask(id, {
        title: options.title,
        description: options.description,
        assignedTo: options.assignee,
        labels,
        priority: options.priority,
        dueDate: options.due,
      });

      success("Task aktualisiert:");
      console.log("  " + formatTask(task));
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });
