// CLI-Ebene: Gesundheitszustand eines einzelnen registrierten Boards fuer die
// aggregierte Uebersicht ('kanban boards', P3-1 zweite Haelfte; spaeter auch
// P3-3 TUI-Board-Wechsel). Getrennt von RegistryService (kennt nur
// registry.json, nichts von DB/Config) und von commands/boards.ts
// (Commander-Verdrahtung) -- dieses Modul ist der einzige Ort, der beides
// zusammenbringt: "welche Boards gibt es" (Registry) und "wie geht es ihnen"
// (DB oeffnen, Schema pruefen, Tasks zaehlen).
import type { Database } from "bun:sqlite";
import { boardExists, getBoardPaths, loadBoardConfig, openDb } from "../core/db.ts";
import { BoardService } from "../core/board-service.ts";
import { TaskService } from "../core/task-service.ts";
import { NotesService } from "../core/notes-service.ts";
import type { RegistryListEntry, RegistryService } from "../core/registry-service.ts";

// Teil der Fehlermeldung aus db.ts assertSchemaCurrent() fuer den Fall
// "Version zu alt" (".. benoetigt wird ..") -- unterscheidet ihn vom
// umgekehrten Fall "Version zu neu" (".. kann hoechstens .."), der keine
// eigene Meldung hier bekommt (fuer 'kanban boards' nicht handlungsleitend,
// siehe Task-Notes) und deshalb im generischen 'error'-Zweig landet.
const SCHEMA_TOO_OLD_MARKER = "benoetigt wird";
const SCHEMA_VERSION_PATTERN = /Version (\d+)/;

export type BoardOverviewStatus =
  | { kind: "ok"; taskCount: number }
  | { kind: "missing" }
  | { kind: "schema-outdated"; version: number }
  | { kind: "error"; message: string };

export interface BoardOverviewEntry {
  path: string;
  name: string;
  registeredAt: string;
  status: BoardOverviewStatus;
}

// Liest genau EIN registriertes Board fuer die Uebersicht. Wirft nie -- jeder
// Fehlerfall (fehlender Pfad, kein Board (mehr) am Pfad, kaputte config.json,
// veraltetes Schema, gesperrte Datenbank) wird zu einem BoardOverviewStatus.
// Aufrufer (runBoardsList) ruft dies pro Board in einer Schleife auf, NICHT
// mit einem try/catch um die ganze Schleife -- ein kaputtes Board darf die
// anderen Zeilen nicht mitreissen.
//
// Oeffnet die DB nur fuer die Dauer dieses Aufrufs und schliesst sie im
// finally wieder -- kein Board haelt seine Verbindung ueber diesen Aufruf
// hinaus offen (P3-1-Notiz: "nur lesend, keine Schreibzugriffe ueber
// Board-Grenzen hinweg").
export function readBoardOverview(
  entry: RegistryListEntry,
  registry: RegistryService,
): BoardOverviewEntry {
  const base = { path: entry.path, name: entry.name, registeredAt: entry.registeredAt };

  // entry.missing prueft nur, ob der Projektordner selbst noch existiert
  // (RegistryService.list()). boardExists() prueft zusaetzlich, ob darin noch
  // ein '.kanban/board.db' liegt -- ein Ordner kann ueberleben, waehrend nur
  // das Board darin geloescht wurde. Wichtig: new Database() (in openDb)
  // wuerde eine fehlende Datei sonst still NEU anlegen -- das waere ein
  // Schreibzugriff durch ein reines Listing-Kommando.
  if (entry.missing || !boardExists(entry.path)) {
    return { ...base, status: { kind: "missing" } };
  }

  const paths = getBoardPaths(entry.path);
  let db: Database;
  try {
    db = openDb(paths.dbPath);
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes(SCHEMA_TOO_OLD_MARKER)) {
      const match = message.match(SCHEMA_VERSION_PATTERN);
      const version = match?.[1] ? Number(match[1]) : 0;
      return { ...base, status: { kind: "schema-outdated", version } };
    }
    return { ...base, status: { kind: "error", message } };
  }

  try {
    const config = loadBoardConfig(paths.configPath);
    const boardService = new BoardService(db, config);
    const notesService = new NotesService(paths.kanbanDir);
    const taskService = new TaskService(db, boardService, notesService);
    const { total } = taskService.getStatus();

    // Name-Cache auffrischen (P3-1, zweite Haelfte): config.json ist die
    // Wahrheit, der Registry-Eintrag nur ein Cache (siehe RegistryEntry).
    // Nur schreiben, wenn der Name wirklich abweicht -- 'kanban boards' ist
    // ein Lesekommando, es soll registry.json nicht bei jedem Aufruf
    // unveraendert neu schreiben.
    if (config.name !== entry.name) {
      registry.register(entry.path, config.name);
    }

    return { path: entry.path, name: config.name, registeredAt: entry.registeredAt, status: { kind: "ok", taskCount: total } };
  } catch (err) {
    return { ...base, status: { kind: "error", message: (err as Error).message } };
  } finally {
    db.close();
  }
}
