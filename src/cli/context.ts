// CLI-Kontext: DB oeffnen, Services bereitstellen
import { openDb, findBoardUpwards, getBoardPaths, loadBoardConfig } from "../core/db.ts";
import { BoardService } from "../core/board-service.ts";
import { TaskService } from "../core/task-service.ts";
import { NotesService } from "../core/notes-service.ts";
import type { BoardConfig } from "../core/types.ts";
import { error } from "./formatters.ts";

export interface CliContext {
  boardService: BoardService;
  taskService: TaskService;
  notesService: NotesService;
  config: BoardConfig;
  kanbanDir: string;
}

// Kontext laden — bricht ab wenn kein Board existiert
export function getContext(cwd?: string): CliContext {
  const startDir = cwd ?? process.cwd();

  // Aufwaertssuche (P3-2, Plan Abschnitt 5.4): gilt fuer alle Kommandos, die
  // ueber getContext() gehen. 'kanban init' (initBoard() direkt) und 'kanban
  // migrate'/'kanban sync' (eigene, bewusst exakte boardExists()-Pruefung)
  // nutzen diese Funktion nicht -- irreversible bzw. unbeaufsichtigt
  // laufende Kommandos bleiben exakt (siehe findBoardUpwards() in db.ts).
  const projectDir = findBoardUpwards(startDir);

  if (projectDir === null) {
    error("Kein Board gefunden. Zuerst 'kanban init' ausfuehren.");
    process.exit(1);
  }

  const paths = getBoardPaths(projectDir);

  // Schema-Guard (P0-5) oder eine kaputte config.json werfen hier —
  // einheitliche, formatierte CLI-Fehlerausgabe statt Stacktrace, analog zur
  // 'kein Board'-Pruefung oben.
  try {
    const db = openDb(paths.dbPath);
    const config: BoardConfig = loadBoardConfig(paths.configPath);
    const boardService = new BoardService(db, config);
    const notesService = new NotesService(paths.kanbanDir);
    const taskService = new TaskService(db, boardService, notesService);

    return { boardService, taskService, notesService, config, kanbanDir: paths.kanbanDir };
  } catch (err) {
    error((err as Error).message);
    process.exit(1);
  }
}
