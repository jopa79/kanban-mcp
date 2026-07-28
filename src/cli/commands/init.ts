// CLI Command: kanban init
import { Command } from "commander";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import { initBoard } from "../../core/db.ts";
import { RegistryService } from "../../core/registry-service.ts";
import { success, error } from "../formatters.ts";

// Default-Speicherort der Registry. Bewusst NUR hier in der CLI-Schicht --
// RegistryService bekommt das Verzeichnis immer explizit uebergeben und
// kennt diesen Pfad nicht.
//
// Bewusst NICHT ~/.kanban/ -- das heisst im Code bereits eindeutig "hier
// liegt ein Board" (siehe getBoardPaths() in db.ts). Ein Board dort UND eine
// Registry dort wuerden zwei Bedeutungen in einen Pfad legen; bei JoPa liegt
// unter ~/.kanban/ bereits ein echtes Board.
//
// Folgt der XDG Base Directory Spec: $XDG_CONFIG_HOME/kanban, sonst
// ~/.config/kanban. Ein leerer XDG_CONFIG_HOME zaehlt laut Spec als "nicht
// gesetzt" -- das gehoert zur Konvention dazu, ihn zu ignorieren waere auf
// Linux-Systemen schlicht falsch.
//
// Ein RELATIVER XDG_CONFIG_HOME ist laut Spec ebenfalls ungueltig und zaehlt
// als nicht gesetzt. Ohne diese Pruefung wuerde die Registry relativ zum
// jeweiligen Arbeitsverzeichnis landen -- also je nach Aufrufort in einer
// anderen Datei.
export function defaultRegistryDir(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const isUsable = xdgConfigHome !== undefined && isAbsolute(xdgConfigHome);
  const configHome = isUsable ? xdgConfigHome : join(homedir(), ".config");
  return join(configHome, "kanban");
}

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
