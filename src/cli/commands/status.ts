// CLI Command: kanban status
import { Command } from "commander";
import { getContext } from "../context.ts";
import { formatStatus } from "../formatters.ts";

export const statusCommand = new Command("status")
  .description("Board-Uebersicht anzeigen")
  .option("--json", "Ausgabe als JSON")
  .action((options) => {
    const { taskService, boardService, config } = getContext();
    const status = taskService.getStatus();

    // Waisen (P1-6, ADR 0001): Tasks, deren Spalte in config.json fehlt.
    // getStatus() zaehlt nur die regulaeren Spalten (task-service.ts bleibt
    // unangetastet -- Core-Aenderung, siehe Bericht an team-lead), deshalb
    // hier zusaetzlich einrechnen, statt sie in 'total' verschwinden zu
    // lassen. 'nicht verstecken' gilt auch fuer 'kanban status'.
    const orphanColumnIds = new Set(boardService.getOrphanColumnIds());
    const orphanCount = orphanColumnIds.size > 0
      ? taskService.listTasks().filter((t) => orphanColumnIds.has(t.columnId)).length
      : 0;
    const total = status.total + orphanCount;

    // JSON-Ausgabe: Status-Objekt mit Board-Name. 'total' wird korrigiert
    // (schliesst Waisen ein), 'orphaned' ist ein rein additives Feld -- kein
    // externer Konsument haengt mehr an diesem Format (siehe a9bb146: der
    // ralph-tracker-Plugin war der letzte, ist entfernt).
    if (options.json) {
      console.log(JSON.stringify({ board: config.name, ...status, total, orphaned: { count: orphanCount } }));
      return;
    }

    console.log();
    console.log(formatStatus(config.name, status.columns, total, orphanCount));
    console.log();
  });
