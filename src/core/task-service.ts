// Task CRUD und Bewegungslogik
import type { Database } from "bun:sqlite";
import { nanoid } from "nanoid";
import type { BoardService } from "./board-service.ts";
import { ArchiveService } from "./archive-service.ts";
import type { AddTaskCheckedResult, AddTaskInput, ListTasksFilter, Task, TaskRow, UpdateTaskInput } from "./types.ts";
import { rowToTask } from "./types.ts";
import { similarity, SIMILARITY_THRESHOLD } from "./similarity.ts";

// TaskService erbt Archiv-Funktionen von ArchiveService
export class TaskService extends ArchiveService {

  // Neuen Task erstellen
  addTask(input: AddTaskInput): Task {
    const id = nanoid(12);
    const now = new Date().toISOString();
    const columnId = input.columnId ?? "todo";

    const column = this.boardService.getColumn(columnId);
    if (!column) {
      throw new Error(`Spalte '${columnId}' existiert nicht`);
    }

    // Position: ans Ende der Zielspalte
    const maxPos = this.db
      .query("SELECT COALESCE(MAX(position), -1) as max_pos FROM tasks WHERE column_id = ? AND archived = 0")
      .get(columnId) as { max_pos: number };
    const position = maxPos.max_pos + 1;

    this.db.run(
      `INSERT INTO tasks (id, title, description, column_id, created_by, assigned_to, labels, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.title,
      input.description ?? null,
      columnId,
      input.createdBy ?? "user",
      input.assignedTo ?? null,
      input.labels ? JSON.stringify(input.labels) : null,
      position,
      now,
      now,
    );

    if (input.dependsOn?.length) {
      const insertDep = this.db.prepare(
        "INSERT OR IGNORE INTO dependencies (task_id, depends_on_id) VALUES (?, ?)"
      );
      for (const depId of input.dependsOn) {
        insertDep.run(id, depId);
      }
    }

    // Notes speichern falls mitgeliefert
    if (input.notes) {
      this.notesService.save(id, input.notes);
    }

    return this.getTask(id)!;
  }

  // Task mit Duplikat-Erkennung erstellen
  addTaskChecked(input: AddTaskInput, options?: { force?: boolean }): AddTaskCheckedResult {
    const existingTasks = this.listTasks();

    const similarTasks = existingTasks.filter(
      (t) => similarity(t.title, input.title) >= SIMILARITY_THRESHOLD,
    );

    const exactMatch = existingTasks.find(
      (t) => t.title.toLowerCase() === input.title.toLowerCase(),
    );

    if (exactMatch && !options?.force) {
      return {
        task: null,
        rejected: true,
        rejectionReason: `Task mit gleichem Titel existiert bereits: [${exactMatch.id.slice(0, 8)}] "${exactMatch.title}" (${exactMatch.columnId})`,
        similarTasks: [exactMatch],
      };
    }

    if (similarTasks.length > 0 && !options?.force) {
      const titles = similarTasks.map((t) => `[${t.id.slice(0, 8)}] "${t.title}"`).join(", ");
      return {
        task: null,
        rejected: true,
        rejectionReason: `Aehnliche Tasks gefunden: ${titles}. Verwende --force zum Erstellen.`,
        similarTasks,
      };
    }

    const task = this.addTask(input);
    return { task, rejected: false, rejectionReason: null, similarTasks };
  }

  // Task per ID holen (exakt oder Prefix)
  getTask(id: string): Task | null {
    let row = this.db
      .query("SELECT * FROM tasks WHERE id = ?")
      .get(id) as TaskRow | null;

    if (!row) {
      row = this.db
        .query("SELECT * FROM tasks WHERE id LIKE ? LIMIT 1")
        .get(`${id}%`) as TaskRow | null;
    }

    if (!row) return null;
    const task = rowToTask(row);
    task.notes = this.notesService.load(task.id);
    task.hasNotes = task.notes !== null;
    task.isBlocked = this.isBlocked(task.id);
    return task;
  }

  // Tasks auflisten mit optionalen Filtern
  listTasks(filter?: ListTasksFilter): Task[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!filter?.includeArchived) {
      conditions.push("archived = 0");
    }
    if (filter?.columnId) {
      conditions.push("column_id = ?");
      params.push(filter.columnId);
    }
    if (filter?.createdBy) {
      conditions.push("created_by = ?");
      params.push(filter.createdBy);
    }
    if (filter?.assignedTo) {
      conditions.push("assigned_to = ?");
      params.push(filter.assignedTo);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const rows = this.db
      .query(`SELECT * FROM tasks ${where} ORDER BY position ASC, created_at ASC`)
      .all(...params) as TaskRow[];

    return rows.map((row) => {
      const task = rowToTask(row);
      task.hasNotes = this.notesService.exists(task.id);
      task.isBlocked = this.isBlocked(task.id);
      return task;
    });
  }

  // Task in andere Spalte verschieben
  moveTask(id: string, columnId: string): Task {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task '${id}' nicht gefunden`);

    const column = this.boardService.getColumn(columnId);
    if (!column) throw new Error(`Spalte '${columnId}' existiert nicht`);

    // Position am Ende der Zielspalte
    const maxPos = this.db
      .query("SELECT COALESCE(MAX(position), -1) as max_pos FROM tasks WHERE column_id = ? AND archived = 0")
      .get(columnId) as { max_pos: number };
    const newPosition = maxPos.max_pos + 1;

    const now = new Date().toISOString();
    this.db.run(
      "UPDATE tasks SET column_id = ?, position = ?, updated_at = ?, version = version + 1 WHERE id = ?",
      columnId, newPosition, now, task.id,
    );

    return this.getTask(task.id)!;
  }

  // Task innerhalb der Spalte verschieben (hoch/runter)
  reorderTask(id: string, direction: "up" | "down"): Task {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task '${id}' nicht gefunden`);

    // Nachbar-Task in der gewuenschten Richtung finden
    const operator = direction === "up" ? "<" : ">";
    const order = direction === "up" ? "DESC" : "ASC";
    const neighbor = this.db
      .query(`SELECT * FROM tasks WHERE column_id = ? AND archived = 0 AND position ${operator} ? ORDER BY position ${order} LIMIT 1`)
      .get(task.columnId, task.position) as TaskRow | null;

    if (!neighbor) return task; // Kein Nachbar, nichts zu tun

    // Positionen tauschen
    const now = new Date().toISOString();
    this.db.run("UPDATE tasks SET position = ?, updated_at = ? WHERE id = ?", neighbor.position, now, task.id);
    this.db.run("UPDATE tasks SET position = ?, updated_at = ? WHERE id = ?", task.position, now, neighbor.id);

    return this.getTask(task.id)!;
  }

  // Task Eigenschaften aendern
  updateTask(id: string, changes: UpdateTaskInput): Task {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task '${id}' nicht gefunden`);

    const updates: string[] = [];
    const params: unknown[] = [];

    if (changes.title !== undefined) { updates.push("title = ?"); params.push(changes.title); }
    if (changes.description !== undefined) { updates.push("description = ?"); params.push(changes.description); }
    if (changes.assignedTo !== undefined) { updates.push("assigned_to = ?"); params.push(changes.assignedTo); }
    if (changes.labels !== undefined) { updates.push("labels = ?"); params.push(JSON.stringify(changes.labels)); }

    // Notes separat behandeln (Dateisystem, nicht DB)
    if (changes.notes !== undefined) {
      if (changes.notes === null) {
        this.notesService.delete(task.id);
      } else {
        this.notesService.save(task.id, changes.notes);
      }
    }

    if (updates.length === 0) return this.getTask(task.id)!;

    const now = new Date().toISOString();
    updates.push("updated_at = ?"); params.push(now);
    updates.push("version = version + 1");
    params.push(task.id);

    this.db.run(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`, ...params);
    return this.getTask(task.id)!;
  }

  // Task loeschen
  deleteTask(id: string): boolean {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task '${id}' nicht gefunden`);
    this.db.run("DELETE FROM tasks WHERE id = ?", task.id);
    this.notesService.delete(task.id);
    return true;
  }

  // Task als erledigt markieren
  completeTask(id: string): Task {
    const terminal = this.boardService.getTerminalColumn();
    if (!terminal) throw new Error("Keine Terminal-Spalte konfiguriert");
    return this.moveTask(id, terminal.id);
  }

  // Abhaengigkeiten: Tasks die diesen Task blockieren
  getDependencies(taskId: string): Task[] {
    const rows = this.db
      .query(`SELECT t.* FROM tasks t JOIN dependencies d ON t.id = d.depends_on_id WHERE d.task_id = ?`)
      .all(taskId) as TaskRow[];
    return rows.map(rowToTask);
  }

  // Abhaengigkeiten: Tasks die von diesem Task abhaengen
  getDependents(taskId: string): Task[] {
    const rows = this.db
      .query(`SELECT t.* FROM tasks t JOIN dependencies d ON t.id = d.task_id WHERE d.depends_on_id = ?`)
      .all(taskId) as TaskRow[];
    return rows.map(rowToTask);
  }

  // Neue Abhaengigkeit anlegen
  addDependency(taskId: string, dependsOnId: string): void {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task '${taskId}' nicht gefunden`);
    const dep = this.getTask(dependsOnId);
    if (!dep) throw new Error(`Task '${dependsOnId}' nicht gefunden`);
    if (taskId === dep.id) throw new Error("Task kann nicht von sich selbst abhaengen");
    this.db.run(
      "INSERT OR IGNORE INTO dependencies (task_id, depends_on_id) VALUES (?, ?)",
      task.id, dep.id,
    );
  }

  // Abhaengigkeit entfernen
  removeDependency(taskId: string, dependsOnId: string): void {
    this.db.run(
      "DELETE FROM dependencies WHERE task_id = ? AND depends_on_id = ?",
      taskId, dependsOnId,
    );
  }

  // Pruefen ob Task blockiert ist (mind. eine Abhaengigkeit nicht in Terminal-Spalte)
  isBlocked(taskId: string): boolean {
    const terminal = this.boardService.getTerminalColumn();
    if (!terminal) return false;
    const deps = this.getDependencies(taskId);
    return deps.some(d => d.columnId !== terminal.id && !d.archived);
  }

  // Board-Status
  getStatus(): { columns: Array<{ column: string; columnId: string; count: number }>; total: number } {
    const columns = this.boardService.getColumns();
    const result = columns.map((col) => ({
      column: col.name,
      columnId: col.id,
      count: this.boardService.getColumnTaskCount(col.id),
    }));
    const total = result.reduce((sum, c) => sum + c.count, 0);
    return { columns: result, total };
  }
}
