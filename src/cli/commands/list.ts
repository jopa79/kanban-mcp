// CLI Command: kanban list
import { Command } from "commander";
import { getContext } from "../context.ts";
import { formatTask } from "../formatters.ts";

export const listCommand = new Command("list")
  .alias("ls")
  .description("Tasks auflisten")
  .option("-c, --column <column>", "Nach Spalte filtern")
  .option("-a, --assignee <name>", "Nach Assignee filtern")
  .option("--json", "Ausgabe als JSON")
  .action((options) => {
    const { taskService, boardService } = getContext();

    const tasks = taskService.listTasks({
      columnId: options.column,
      assignedTo: options.assignee,
    });

    // JSON-Ausgabe: Array direkt ausgeben
    if (options.json) {
      console.log(JSON.stringify(tasks));
      return;
    }

    if (tasks.length === 0) {
      console.log("Keine Tasks gefunden.");
      return;
    }

    // Nach Spalte gruppieren
    const columns = boardService.getColumns();
    for (const col of columns) {
      const colTasks = tasks.filter(t => t.columnId === col.id);
      if (colTasks.length === 0) continue;

      console.log(`\n  ${col.name} (${colTasks.length})`);
      console.log("  " + "─".repeat(40));
      for (const task of colTasks) {
        console.log("  " + formatTask(task));
      }
    }
    console.log();
  });
