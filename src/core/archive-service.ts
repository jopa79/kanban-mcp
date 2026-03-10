// Archiv-Management: archivieren, wiederherstellen, purgen
import type { Database } from "bun:sqlite";
import type { BoardService } from "./board-service.ts";
import type { NotesService } from "./notes-service.ts";
import type { Task, TaskRow } from "./types.ts";
import { rowToTask } from "./types.ts";

export class ArchiveService {
  constructor(
    protected db: Database,
    protected boardService: BoardService,
    protected notesService: NotesService,
  ) {}

  // Tasks archivieren (aus Terminal-Spalte oder nach Kriterien)
  archiveTasks(options?: {
    columnId?: string;
    olderThanDays?: number;
    dryRun?: boolean;
  }): { archivedCount: number; tasks: Task[] } {
    const conditions: string[] = ["archived = 0"];
    const params: unknown[] = [];

    if (options?.columnId) {
      conditions.push("column_id = ?");
      params.push(options.columnId);
    } else {
      const terminal = this.boardService.getTerminalColumn();
      if (terminal) {
        conditions.push("column_id = ?");
        params.push(terminal.id);
      }
    }

    if (options?.olderThanDays) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - options.olderThanDays);
      conditions.push("updated_at < ?");
      params.push(cutoff.toISOString());
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const rows = this.db
      .query(`SELECT * FROM tasks ${where}`)
      .all(...params) as TaskRow[];
    const tasks = rows.map(rowToTask);

    if (options?.dryRun) {
      return { archivedCount: tasks.length, tasks };
    }

    if (tasks.length > 0) {
      const now = new Date().toISOString();
      this.db.run(
        `UPDATE tasks SET archived = 1, updated_at = ? ${where}`,
        now,
        ...params,
      );
    }

    return { archivedCount: tasks.length, tasks };
  }

  // Einzelnen Task archivieren (per ID)
  archiveTask(id: string): Task {
    const row = this.db
      .query("SELECT * FROM tasks WHERE id = ? OR id LIKE ?")
      .get(id, `${id}%`) as TaskRow | null;
    if (!row) throw new Error(`Task '${id}' nicht gefunden`);
    const task = rowToTask(row);
    if (task.archived) throw new Error(`Task '${id}' ist bereits archiviert`);

    const now = new Date().toISOString();
    this.db.run(
      "UPDATE tasks SET archived = 1, updated_at = ?, version = version + 1 WHERE id = ?",
      now, task.id,
    );
    const updated = this.db.query("SELECT * FROM tasks WHERE id = ?").get(task.id) as TaskRow;
    return rowToTask(updated);
  }

  // Archivierten Task wiederherstellen
  restoreTask(id: string, targetColumnId?: string): Task {
    const row = this.db
      .query("SELECT * FROM tasks WHERE id = ? OR id LIKE ?")
      .get(id, `${id}%`) as TaskRow | null;

    if (!row) {
      throw new Error(`Task '${id}' nicht gefunden`);
    }

    const task = rowToTask(row);
    if (!task.archived) {
      throw new Error(`Task '${id}' ist nicht archiviert`);
    }

    const columnId = targetColumnId ?? "todo";
    const column = this.boardService.getColumn(columnId);
    if (!column) {
      throw new Error(`Spalte '${columnId}' existiert nicht`);
    }

    const now = new Date().toISOString();
    this.db.run(
      "UPDATE tasks SET archived = 0, column_id = ?, updated_at = ?, version = version + 1 WHERE id = ?",
      columnId,
      now,
      task.id,
    );

    const updated = this.db
      .query("SELECT * FROM tasks WHERE id = ?")
      .get(task.id) as TaskRow;
    return rowToTask(updated);
  }

  // Archiv permanent loeschen
  purgeArchive(options?: { dryRun?: boolean }): { deletedCount: number; tasks: Task[] } {
    const rows = this.db
      .query("SELECT * FROM tasks WHERE archived = 1")
      .all() as TaskRow[];
    const tasks = rows.map(rowToTask);

    if (options?.dryRun) {
      return { deletedCount: tasks.length, tasks };
    }

    this.db.run("DELETE FROM tasks WHERE archived = 1");
    return { deletedCount: tasks.length, tasks };
  }

  // Archiv-Statistiken
  getArchiveStats(): { total: number; byColumn: Record<string, number> } {
    const rows = this.db
      .query("SELECT column_id, COUNT(*) as count FROM tasks WHERE archived = 1 GROUP BY column_id")
      .all() as Array<{ column_id: string; count: number }>;

    const byColumn: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      byColumn[row.column_id] = row.count;
      total += row.count;
    }

    return { total, byColumn };
  }
}
