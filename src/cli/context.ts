// CLI-Kontext: DB oeffnen, Services bereitstellen
import { readFileSync } from "node:fs";
import { openDb, boardExists, getBoardPaths } from "../core/db.ts";
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
  const projectDir = cwd ?? process.cwd();

  if (!boardExists(projectDir)) {
    error("Kein Board gefunden. Zuerst 'kanban init' ausfuehren.");
    process.exit(1);
  }

  const paths = getBoardPaths(projectDir);
  const db = openDb(paths.dbPath);
  const config: BoardConfig = JSON.parse(readFileSync(paths.configPath, "utf-8"));
  const boardService = new BoardService(db);
  const notesService = new NotesService(paths.kanbanDir);
  const taskService = new TaskService(db, boardService, notesService);

  return { boardService, taskService, notesService, config, kanbanDir: paths.kanbanDir };
}
