// MCP-Kontext: DB oeffnen, Services bereitstellen (analog zu CLI context)
import { readFileSync } from "node:fs";
import { openDb, boardExists, getBoardPaths } from "../core/db.ts";
import { BoardService } from "../core/board-service.ts";
import { TaskService } from "../core/task-service.ts";
import { NotesService } from "../core/notes-service.ts";
import type { BoardConfig } from "../core/types.ts";

export interface McpContext {
  boardService: BoardService;
  taskService: TaskService;
  notesService: NotesService;
  config: BoardConfig;
}

// Kontext laden — wirft Fehler wenn kein Board existiert
export function getContext(workingDir: string): McpContext {
  if (!boardExists(workingDir)) {
    throw new Error("Kein Board gefunden. Zuerst kanban_init aufrufen.");
  }

  const paths = getBoardPaths(workingDir);
  const db = openDb(paths.dbPath);
  const config: BoardConfig = JSON.parse(readFileSync(paths.configPath, "utf-8"));
  const boardService = new BoardService(db);
  const notesService = new NotesService(paths.kanbanDir);
  const taskService = new TaskService(db, boardService, notesService);

  return { boardService, taskService, notesService, config };
}

// DB oeffnen, Aktion ausfuehren, DB garantiert schliessen
export function withContext<T>(workingDir: string, action: (ctx: McpContext) => T): T {
  if (!boardExists(workingDir)) {
    throw new Error("Kein Board gefunden. Zuerst kanban_init aufrufen.");
  }

  const paths = getBoardPaths(workingDir);
  const db = openDb(paths.dbPath);
  const config: BoardConfig = JSON.parse(readFileSync(paths.configPath, "utf-8"));
  const boardService = new BoardService(db);
  const notesService = new NotesService(paths.kanbanDir);
  const taskService = new TaskService(db, boardService, notesService);

  try {
    return action({ boardService, taskService, notesService, config });
  } finally {
    db.close();
  }
}
