// CLI Command: kanban export — Board als ZIP exportieren
import { Command } from "commander";
import { exportBoard } from "../../core/export-service.ts";
import { success, error } from "../formatters.ts";

export const exportCommand = new Command("export")
  .description("Board als ZIP-Archiv exportieren")
  .argument("[output-path]", "Pfad fuer die ZIP-Datei (default: ./kanban-export-{datum}.zip)")
  .action(async (outputPath?: string) => {
    try {
      const zipPath = await exportBoard(process.cwd(), outputPath);
      success(`Board exportiert nach ${zipPath}`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });
