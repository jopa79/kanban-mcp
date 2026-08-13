// CLI Command: kanban init
import { Command } from "commander";
import { initBoard } from "../../core/db.ts";
import { RegistryService } from "../../core/registry-service.ts";
import { defaultRegistryDir } from "../board-overview.ts";
import { success, error } from "../formatters.ts";

export interface RunInitOptions {
  register: boolean;
  registryDir?: string;
}

// Testbarer Kern von 'kanban init', entkoppelt von Commander und
// process.cwd(). Registriert nur, wenn options.register true ist --
// initBoard() selbst registriert nie (siehe registry-service.ts).
export function runInit(projectDir: string, name: string, options: RunInitOptions): string {
  const kanbanDir = initBoard(projectDir, name);

  if (options.register) {
    const registry = new RegistryService(options.registryDir ?? defaultRegistryDir());
    registry.register(projectDir, name);
  }

  return kanbanDir;
}

export const initCommand = new Command("init")
  .description("Neues Kanban Board initialisieren")
  .argument("[name]", "Board-Name", "Kanban Board")
  .option("--no-register", "Board nicht in der Registry eintragen (~/.config/kanban/registry.json)")
  .action((name: string, options: { register: boolean }) => {
    try {
      const kanbanDir = runInit(process.cwd(), name, { register: options.register });
      success(`Board '${name}' erstellt in ${kanbanDir}`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });
