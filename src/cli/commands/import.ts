// CLI Command: kanban import — Board aus ZIP importieren
import { Command } from "commander";
import { importBoard } from "../../core/export-service.ts";
import { success, error } from "../formatters.ts";

export const importCommand = new Command("import")
  .description("Board aus ZIP-Archiv importieren")
  .argument("<zip-path>", "Pfad zur ZIP-Datei")
  .option("--force", "Bestehendes Board ueberschreiben")
  .action(async (zipPath: string, options) => {
    try {
      const report = await importBoard(process.cwd(), zipPath, { force: options.force });
      success("Board erfolgreich importiert");
      if (report.note) console.log(report.note);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });
