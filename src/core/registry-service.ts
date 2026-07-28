// Registry-Service: verwaltet die Liste bekannter Boards in <registryDir>/registry.json
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const REGISTRY_VERSION = 1;
const REGISTRY_FILE_NAME = "registry.json";

// Ein Board-Eintrag, wie er in registry.json persistiert wird.
// Nur 'path' ist Wahrheit -- 'name' ist ein Cache aus der jeweiligen
// config.json und wird beim Lesen der einzelnen Boards aufgefrischt (Teil 2
// dieses Tasks, haengt an P0-1/BoardConfig und ist hier bewusst nicht dabei).
export interface RegistryEntry {
  path: string;
  name: string;
  registeredAt: string;
}

// Eintrag mit Laufzeit-Status fuer die Anzeige -- 'missing' wird bei jedem
// list()-Aufruf frisch berechnet, nie persistiert.
export interface RegistryListEntry extends RegistryEntry {
  missing: boolean;
}

// Rohformat der registry.json-Datei
interface RegistryFile {
  version: number;
  boards: RegistryEntry[];
}

export class RegistryService {
  private readonly registryPath: string;

  // registryDir ist ein Pflichtparameter und wird injiziert. Der Aufrufer
  // (CLI) entscheidet ueber den Default -- siehe defaultRegistryDir() in
  // cli/commands/init.ts. Hier wird niemals ein Home-Verzeichnis hartkodiert,
  // sonst wuerden Tests versehentlich in die echte Registry schreiben.
  constructor(private readonly registryDir: string) {
    this.registryPath = join(registryDir, REGISTRY_FILE_NAME);
  }

  // Board registrieren. Idempotent: derselbe Pfad erzeugt keinen zweiten
  // Eintrag. Der Name wird aufgefrischt (er ist ohnehin nur ein Cache), das
  // urspruengliche registeredAt bleibt erhalten -- "registriert seit" soll
  // bei erneuter Registrierung nicht zuruecksetzen.
  register(boardPath: string, name: string): void {
    const registry = this.readRegistry();
    const existing = registry.boards.find((b) => b.path === boardPath);

    if (existing) {
      existing.name = name;
    } else {
      registry.boards.push({
        path: boardPath,
        name,
        registeredAt: new Date().toISOString(),
      });
    }

    this.writeRegistry(registry);
  }

  // Board aus der Registry entfernen. Kein Fehler, wenn der Pfad nicht (mehr)
  // registriert ist -- Entfernen eines bereits entfernten Eintrags ist ein No-op.
  remove(boardPath: string): void {
    const registry = this.readRegistry();
    registry.boards = registry.boards.filter((b) => b.path !== boardPath);
    this.writeRegistry(registry);
  }

  // Alle registrierten Boards mit Laufzeit-Status. Tote Pfade werden als
  // 'missing' markiert, NICHT entfernt -- ein ausgehaengtes Netzlaufwerk ist
  // kein geloeschtes Board. Aufraeumen ist eine bewusste Aktion (remove()).
  list(): RegistryListEntry[] {
    const registry = this.readRegistry();
    return registry.boards.map((b) => ({ ...b, missing: !existsSync(b.path) }));
  }

  // Registry-Datei lesen. Fehlt sie (z.B. frischer Rechner oder frisches
  // Projekt), gilt sie als leer -- das ist der Normalfall, kein Fehler.
  private readRegistry(): RegistryFile {
    if (!existsSync(this.registryPath)) {
      return { version: REGISTRY_VERSION, boards: [] };
    }
    const raw = readFileSync(this.registryPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<RegistryFile>;
    return {
      version: parsed.version ?? REGISTRY_VERSION,
      boards: parsed.boards ?? [],
    };
  }

  // Atomar schreiben: eindeutige tmp-Datei, dann rename. rename() ist auf
  // demselben Dateisystem atomar -- ein direktes writeFileSync waere es
  // nicht und koennte bei zwei gleichzeitig schreibenden Prozessen die Datei
  // zerreissen.
  private writeRegistry(registry: RegistryFile): void {
    if (!existsSync(this.registryDir)) {
      mkdirSync(this.registryDir, { recursive: true });
    }
    const tmpPath = `${this.registryPath}.tmp-${randomUUID()}`;
    writeFileSync(tmpPath, JSON.stringify(registry, null, 2));
    renameSync(tmpPath, this.registryPath);
  }
}
