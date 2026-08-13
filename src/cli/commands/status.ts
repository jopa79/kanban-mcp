// CLI Command: kanban status
import { Command } from "commander";
import { getContext } from "../context.ts";
import { formatStatus } from "../formatters.ts";

export const statusCommand = new Command("status")
  .description("Board-Uebersicht anzeigen")
  .option("--json", "Ausgabe als JSON")
  .action((options) => {
    const { taskService, config } = getContext();

    // Waisen (P1-6, ADR 0001): Tasks, deren Spalte in config.json fehlt.
    // getStatus() zaehlt sie seit e5c6e14 selbst mit und liefert sie separat
    // als orphanCount -- hier NICHT erneut addieren, sonst doppelt gezaehlt.
    // Eine Quelle fuer beide Oberflaechen: 'kanban status' und MCP
    // 'kanban_status' zeigen dieselbe Summe.
    const status = taskService.getStatus();

    // JSON-Ausgabe: 'orphaned' ist ein rein additives Feld -- kein externer
    // Konsument haengt mehr an diesem Format (siehe a9bb146: der
    // ralph-tracker-Plugin war der letzte, ist entfernt).
    if (options.json) {
      console.log(JSON.stringify({ board: config.name, ...status, orphaned: { count: status.orphanCount } }));
      return;
    }

    console.log();
    console.log(
      formatStatus(config.name, status.columns, status.total, status.orphanCount, status.transitionCount),
    );
    console.log();
  });
