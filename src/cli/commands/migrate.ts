// CLI Command: kanban migrate — Schema v2 auf v3 heben (ADR 0001, Plan 2.2/2.3)
//
// Bewusst OHNE getContext()/openDb(): der Schema-Guard in db.ts wuerde ein
// v2-Board sofort ablehnen. 'kanban migrate' ist von diesem Guard explizit
// ausgenommen und arbeitet direkt mit migrate-v3.ts.
import { Command } from "commander";
import { boardExists, getBoardPaths } from "../../core/db.ts";
import { migrateToV3, MigrationAbortedError } from "../../core/migrate-v3.ts";
import { success, error } from "../formatters.ts";

export const migrateCommand = new Command("migrate")
  .description("Board-Schema von Version 2 auf Version 3 migrieren (Spalten -> config.json, ADR 0001)")
  .option("--dry-run", "Nur Bericht anzeigen, keine Schreibvorgaenge")
  .option("--yes", "Nicht-interaktiv ausfuehren (fuer Skripte) — ueberspringt die Bestaetigung")
  .action((options: { dryRun?: boolean; yes?: boolean }) => {
    const projectDir = process.cwd();
    if (!boardExists(projectDir)) {
      error("Kein Board gefunden. Zuerst 'kanban init' ausfuehren.");
      process.exit(1);
    }
    const paths = getBoardPaths(projectDir);

    try {
      // Erst als Vorschau (dry-run) laufen lassen -- unabhaengig davon, ob
      // der Aufrufer selbst --dry-run gesetzt hat. Das liefert Ist-Version,
      // Ziel-Version und die geplanten Schritte, ohne irgendetwas anzufassen.
      const preview = migrateToV3(paths.dbPath, paths.configPath, { dryRun: true });

      if (preview.status === "already-migrated") {
        console.log("Board ist bereits auf Schema-Version 3. Nichts zu tun.");
        console.log(`(${preview.taskCount} Tasks, ${preview.dependencyCount} Dependencies)`);
        return;
      }

      console.log("Board-Schema: Version 2 -> Version 3");
      console.log(`  ${preview.taskCount} Tasks, ${preview.dependencyCount} Dependencies, ${preview.columnCount} Spalten`);
      console.log(`  Eintrittsspalten gesetzt auf: ${preview.entryColumnIds.join(", ")}. Anpassbar in config.json.`);
      console.log(`  Backup wird angelegt: ${paths.dbPath}.bak-v2`);

      if (options.dryRun) {
        console.log("\n--dry-run: keine Aenderungen vorgenommen.");
        return;
      }

      if (!options.yes) {
        console.log("");
        error("Bestaetigung erforderlich. Erneut mit --yes ausfuehren, um die Migration durchzufuehren.");
        process.exit(1);
      }

      const result = migrateToV3(paths.dbPath, paths.configPath, { dryRun: false });
      success(
        `Migration abgeschlossen: ${result.taskCount} Tasks, ${result.dependencyCount} Dependencies, ` +
        `${result.columnCount} Spalten migriert.`,
      );
      console.log(`Backup: ${result.backupPath}`);
    } catch (err) {
      if (err instanceof MigrationAbortedError) {
        error(err.message);
      } else {
        error((err as Error).message);
      }
      process.exit(1);
    }
  });
