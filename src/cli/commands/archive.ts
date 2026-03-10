// CLI Commands: kanban archive, restore, purge
import { Command } from "commander";
import { getContext } from "../context.ts";
import { formatTask, success, error } from "../formatters.ts";

// --- archive ---
export const archiveCommand = new Command("archive")
  .description("Erledigte Tasks archivieren")
  .option("-c, --column <column>", "Aus bestimmter Spalte archivieren")
  .option("-o, --older-than <days>", "Nur Tasks aelter als N Tage", parseInt)
  .option("--dry-run", "Vorschau ohne Aenderung")
  .action((options) => {
    try {
      const { taskService } = getContext();
      const result = taskService.archiveTasks({
        columnId: options.column,
        olderThanDays: options.olderThan,
        dryRun: options.dryRun,
      });

      if (options.dryRun) {
        console.log(`Wuerde ${result.archivedCount} Task(s) archivieren:`);
        for (const task of result.tasks) {
          console.log("  " + formatTask(task));
        }
        return;
      }

      success(`${result.archivedCount} Task(s) archiviert`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

// --- restore ---
export const restoreCommand = new Command("restore")
  .description("Archivierten Task wiederherstellen")
  .argument("<id>", "Task-ID")
  .option("-t, --to <column>", "In bestimmte Spalte wiederherstellen")
  .action((id: string, options) => {
    try {
      const { taskService } = getContext();
      const task = taskService.restoreTask(id, options.to);
      success("Task wiederhergestellt:");
      console.log("  " + formatTask(task));
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

// --- purge ---
export const purgeCommand = new Command("purge")
  .description("Archiv permanent loeschen")
  .option("--confirm", "Loeschung bestaetigen (erforderlich)")
  .option("--dry-run", "Vorschau ohne Aenderung")
  .action((options) => {
    try {
      const { taskService } = getContext();

      if (options.dryRun) {
        const result = taskService.purgeArchive({ dryRun: true });
        console.log(`Wuerde ${result.deletedCount} archivierte(n) Task(s) loeschen:`);
        for (const task of result.tasks) {
          console.log("  " + formatTask(task));
        }
        return;
      }

      if (!options.confirm) {
        error("--confirm Flag erforderlich um archivierte Tasks permanent zu loeschen");
        process.exit(1);
      }

      const result = taskService.purgeArchive();
      success(`${result.deletedCount} archivierte(n) Task(s) permanent geloescht`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });
