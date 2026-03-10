// Test-Helfer: temporaeres Board erstellen und aufraeumen
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initBoard, openDb, getBoardPaths } from "../src/core/db.ts";
import { BoardService } from "../src/core/board-service.ts";
import { TaskService } from "../src/core/task-service.ts";
import { NotesService } from "../src/core/notes-service.ts";
import type { Database } from "bun:sqlite";

export interface TestContext {
  dir: string;
  db: Database;
  boardService: BoardService;
  taskService: TaskService;
  notesService: NotesService;
  cleanup: () => void;
}

// Erstellt ein temporaeres Board mit allen Services
export function createTestBoard(name = "Test Board"): TestContext {
  const dir = mkdtempSync(join(tmpdir(), "kanban-test-"));
  initBoard(dir, name);
  const paths = getBoardPaths(dir);
  const db = openDb(paths.dbPath);
  const boardService = new BoardService(db);
  const notesService = new NotesService(paths.kanbanDir);
  const taskService = new TaskService(db, boardService, notesService);

  const cleanup = () => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  };

  return { dir, db, boardService, taskService, notesService, cleanup };
}
