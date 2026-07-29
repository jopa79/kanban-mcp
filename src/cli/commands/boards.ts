// CLI Commands: kanban boards, boards add, boards remove (P3-1, zweite Haelfte)
import { Command } from "commander";
import { basename, resolve } from "node:path";
import { RegistryService } from "../../core/registry-service.ts";
import { boardExists, getBoardPaths, loadBoardConfig } from "../../core/db.ts";
import { readBoardOverview, type BoardOverviewEntry } from "../board-overview.ts";
import { defaultRegistryDir } from "./init.ts";
import { formatBoardsList, success, error } from "../formatters.ts";

// Testbarer Kern von 'kanban boards': registryDir immer explizit, wie
// runInit() in init.ts -- Tests laufen so gegen ein Temp-Verzeichnis, nie
// gegen die echte Registry. Ein try/catch um die Schleife waere hier falsch
// (siehe readBoardOverview) -- jedes Board faengt seinen eigenen Fehler ab.
export function runBoardsList(registryDir: string): BoardOverviewEntry[] {
  const registry = new RegistryService(registryDir);
  return registry.list().map((entry) => readBoardOverview(entry, registry));
}

// Registriert ein Board nachtraeglich (z.B. mit --no-register angelegt, oder
// von einem anderen Rechner uebernommen). Braucht -- anders als 'kanban
// init' -- keinen Namen als Argument: der Name kommt aus config.json, falls
// lesbar. Ist sie es nicht (z.B. ein unmigriertes v2-Board), faellt der Name
// auf den Verzeichnisnamen zurueck -- 'kanban boards' zeigt den echten
// Zustand (inkl. Schema-Warnung) bei jedem Aufruf ohnehin frisch an (siehe
// readBoardOverview); der Platzhalter hier ist nur der erste Registry-Eintrag.
export function runBoardsAdd(
  pathArg: string | undefined,
  registryDir: string,
): { path: string; name: string } {
  const projectDir = resolve(pathArg ?? process.cwd());

  if (!boardExists(projectDir)) {
    throw new Error(`Kein Board gefunden in ${projectDir}. Zuerst 'kanban init' dort ausfuehren.`);
  }

  let name: string;
  try {
    name = loadBoardConfig(getBoardPaths(projectDir).configPath).name;
  } catch {
    name = basename(projectDir);
  }

  new RegistryService(registryDir).register(projectDir, name);
  return { path: projectDir, name };
}

// Entfernt einen Registry-Eintrag. RegistryService.remove() ist idempotent
// (kein Fehler bei nicht registriertem Pfad) -- 'removed' unterscheidet fuer
// die Ausgabe trotzdem, ob wirklich etwas entfernt wurde.
export function runBoardsRemove(
  pathArg: string,
  registryDir: string,
): { path: string; removed: boolean } {
  const projectDir = resolve(pathArg);
  const registry = new RegistryService(registryDir);
  const wasRegistered = registry.list().some((b) => b.path === projectDir);
  registry.remove(projectDir);
  return { path: projectDir, removed: wasRegistered };
}

// JSON-Ausgabe: die interne discriminated union (BoardOverviewStatus) flach
// geklopft auf 'status' + Zusatzfelder -- ein externer Konsument soll keine
// TypeScript-Unions nachbilden muessen, um das Feld zu lesen (analog zu
// 'orphaned' in status.ts).
function toJson(entry: BoardOverviewEntry) {
  const { status } = entry;
  return {
    path: entry.path,
    name: entry.name,
    registeredAt: entry.registeredAt,
    status: status.kind,
    ...(status.kind === "ok" ? { taskCount: status.taskCount } : {}),
    ...(status.kind === "schema-outdated" ? { schemaVersion: status.version } : {}),
    ...(status.kind === "error" ? { message: status.message } : {}),
  };
}

export const boardsCommand = new Command("boards")
  .description("Registrierte Boards anzeigen")
  .option("--json", "Ausgabe als JSON")
  .action((options: { json?: boolean }) => {
    const entries = runBoardsList(defaultRegistryDir());

    if (options.json) {
      console.log(JSON.stringify({ boards: entries.map(toJson) }));
      return;
    }

    console.log();
    console.log(formatBoardsList(entries));
    console.log();
  });

boardsCommand
  .command("add [pfad]")
  .description("Board nachtraeglich in der Registry eintragen (Default: aktuelles Verzeichnis)")
  .action((pfad: string | undefined) => {
    try {
      const result = runBoardsAdd(pfad, defaultRegistryDir());
      success(`Board '${result.name}' registriert: ${result.path}`);
    } catch (err) {
      error((err as Error).message);
      process.exit(1);
    }
  });

boardsCommand
  .command("remove <pfad>")
  .description("Board aus der Registry entfernen")
  .action((pfad: string) => {
    const result = runBoardsRemove(pfad, defaultRegistryDir());
    if (result.removed) {
      success(`Board entfernt: ${result.path}`);
    } else {
      success(`Board war nicht registriert: ${result.path}`);
    }
  });
