// CLI Command: kanban note — Notes im Editor oeffnen
import { Command } from "commander";
import { spawnSync } from "node:child_process";
import { getContext } from "../context.ts";
import { error, success } from "../formatters.ts";

export const noteCommand = new Command("note")
  .description("Notizen eines Tasks im Editor oeffnen")
  .argument("<id>", "Task-ID")
  .action((id: string) => {
    try {
      const { taskService, notesService } = getContext();
      const task = taskService.getTask(id);
      if (!task) {
        error(`Task '${id}' nicht gefunden`);
        process.exit(1);
      }

      const editor = process.env.EDITOR ?? process.env.VISUAL ?? "vi";
      const notePath = notesService.getPath(task.id);

      // Ordner und leere Datei erstellen falls noetig
      if (!notesService.exists(task.id)) {
        notesService.save(task.id, `# ${task.title}\n\n`);
      }

      const result = spawnSync(editor, [notePath], {
        stdio: "inherit",
      });

      if (result.status === 0) {
        success(`Notizen fuer '${task.title}' gespeichert`);
      } else {
        error(`Editor beendet mit Status ${result.status}`);
        process.exit(1);
      }
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });
