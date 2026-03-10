// CLI Command: kanban init
import { Command } from "commander";
import { initBoard } from "../../core/db.ts";
import { success, error } from "../formatters.ts";

export const initCommand = new Command("init")
  .description("Neues Kanban Board initialisieren")
  .argument("[name]", "Board-Name", "Kanban Board")
  .action((name: string) => {
    try {
      const kanbanDir = initBoard(process.cwd(), name);
      success(`Board '${name}' erstellt in ${kanbanDir}`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });
