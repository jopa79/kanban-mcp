// Board Export/Import als ZIP-Archiv
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { $ } from "bun";
import { openDb, createSchema, boardExists, getBoardPaths } from "./db.ts";
import { BoardService } from "./board-service.ts";
import { TaskService } from "./task-service.ts";
import { NotesService } from "./notes-service.ts";
import type { BoardConfig, Column, Task } from "./types.ts";

const EXPORT_VERSION = 2;

// Export-Datenstruktur in board.json
interface BoardExport {
  version: number;
  exportedAt: string;
  config: BoardConfig;
  columns: Column[];
  tasks: Task[];
  dependencies: Array<{ taskId: string; dependsOnId: string }>;
}

// Board als ZIP exportieren — gibt den Pfad zur ZIP-Datei zurueck
export async function exportBoard(workingDir: string, outputPath?: string): Promise<string> {
  if (!boardExists(workingDir)) {
    throw new Error("Kein Board gefunden. Zuerst 'kanban init' ausfuehren.");
  }

  const paths = getBoardPaths(workingDir);
  const db = openDb(paths.dbPath);
  const config: BoardConfig = JSON.parse(readFileSync(paths.configPath, "utf-8"));
  const boardService = new BoardService(db);
  const notesService = new NotesService(paths.kanbanDir);
  const taskService = new TaskService(db, boardService, notesService);

  // Alle Daten sammeln
  const columns = boardService.getColumns();
  const tasks = taskService.listTasks({ includeArchived: true });
  const dependencies = getAllDependencies(db);

  const exportData: BoardExport = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    config,
    columns,
    tasks,
    dependencies,
  };

  // Temporaeres Verzeichnis fuer ZIP-Inhalt
  const tmpDir = join(workingDir, ".kanban", "_export_tmp");
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  try {
    // board.json schreiben
    writeFileSync(join(tmpDir, "board.json"), JSON.stringify(exportData, null, 2));

    // Notes kopieren (falls vorhanden)
    const notesDir = join(paths.kanbanDir, "notes");
    if (existsSync(notesDir)) {
      const noteFiles = readdirSync(notesDir).filter(f => f.endsWith(".md"));
      if (noteFiles.length > 0) {
        const tmpNotesDir = join(tmpDir, "notes");
        mkdirSync(tmpNotesDir, { recursive: true });
        for (const file of noteFiles) {
          const content = readFileSync(join(notesDir, file), "utf-8");
          writeFileSync(join(tmpNotesDir, file), content);
        }
      }
    }

    // ZIP erstellen
    const date = new Date().toISOString().slice(0, 10);
    const zipPath = resolve(outputPath ?? join(workingDir, `kanban-export-${date}.zip`));

    // Falls ZIP schon existiert, loeschen (zip fuegt sonst hinzu)
    if (existsSync(zipPath)) rmSync(zipPath);

    await $`cd ${tmpDir} && zip -r ${zipPath} .`.quiet();
    db.close();

    return zipPath;
  } finally {
    // Aufraeumen
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

// Board aus ZIP importieren
export async function importBoard(workingDir: string, zipPath: string, options?: { force?: boolean }): Promise<void> {
  const absZipPath = resolve(zipPath);
  if (!existsSync(absZipPath)) {
    throw new Error(`ZIP-Datei nicht gefunden: ${absZipPath}`);
  }

  // Bestehendes Board pruefen
  if (boardExists(workingDir)) {
    if (!options?.force) {
      throw new Error("Board existiert bereits. Verwende --force zum Ueberschreiben.");
    }
    // Altes Board loeschen
    const kanbanDir = join(workingDir, ".kanban");
    rmSync(kanbanDir, { recursive: true });
  }

  // Temporaeres Verzeichnis zum Entpacken
  const tmpDir = join(workingDir, ".kanban_import_tmp");
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  try {
    await $`unzip -o ${absZipPath} -d ${tmpDir}`.quiet();

    // board.json lesen und validieren
    const boardJsonPath = join(tmpDir, "board.json");
    if (!existsSync(boardJsonPath)) {
      throw new Error("Ungueltige ZIP-Datei: board.json fehlt");
    }

    const exportData: BoardExport = JSON.parse(readFileSync(boardJsonPath, "utf-8"));

    if (!exportData.version || exportData.version > EXPORT_VERSION) {
      throw new Error(`Inkompatible Schema-Version: ${exportData.version} (erwartet: <= ${EXPORT_VERSION})`);
    }

    // Board-Verzeichnis erstellen
    const kanbanDir = join(workingDir, ".kanban");
    mkdirSync(kanbanDir, { recursive: true });

    // Config schreiben
    writeFileSync(join(kanbanDir, "config.json"), JSON.stringify(exportData.config, null, 2));

    // DB erstellen und befuellen
    const dbPath = join(kanbanDir, "board.db");
    const db = openDb(dbPath);
    createSchema(db);

    // Spalten einfuegen
    const insertCol = db.prepare(
      "INSERT OR REPLACE INTO columns (id, name, position, wip_limit, is_terminal) VALUES (?, ?, ?, ?, ?)"
    );
    for (const col of exportData.columns) {
      insertCol.run(col.id, col.name, col.position, col.wipLimit, col.isTerminal ? 1 : 0);
    }

    // Tasks einfuegen
    const insertTask = db.prepare(
      `INSERT INTO tasks (id, title, description, column_id, created_by, assigned_to, labels, position, created_at, updated_at, archived, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const task of exportData.tasks) {
      insertTask.run(
        task.id, task.title, task.description,
        task.columnId, task.createdBy, task.assignedTo,
        task.labels.length > 0 ? JSON.stringify(task.labels) : null,
        task.position, task.createdAt, task.updatedAt,
        task.archived ? 1 : 0, task.version,
      );
    }

    // Dependencies einfuegen (mit Validierung)
    const taskIds = new Set(exportData.tasks.map(t => t.id));
    const insertDep = db.prepare(
      "INSERT OR IGNORE INTO dependencies (task_id, depends_on_id) VALUES (?, ?)"
    );
    for (const dep of exportData.dependencies) {
      if (taskIds.has(dep.taskId) && taskIds.has(dep.dependsOnId)) {
        insertDep.run(dep.taskId, dep.dependsOnId);
      }
    }

    db.close();

    // Notes kopieren
    const tmpNotesDir = join(tmpDir, "notes");
    if (existsSync(tmpNotesDir)) {
      const notesDir = join(kanbanDir, "notes");
      mkdirSync(notesDir, { recursive: true });
      const noteFiles = readdirSync(tmpNotesDir).filter(f => f.endsWith(".md"));
      for (const file of noteFiles) {
        const content = readFileSync(join(tmpNotesDir, file), "utf-8");
        writeFileSync(join(notesDir, file), content);
      }
    }
  } finally {
    // Aufraeumen
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

// Alle Dependencies aus der DB lesen
function getAllDependencies(db: import("bun:sqlite").Database): Array<{ taskId: string; dependsOnId: string }> {
  const rows = db.query("SELECT task_id, depends_on_id FROM dependencies").all() as Array<{
    task_id: string;
    depends_on_id: string;
  }>;
  return rows.map(r => ({ taskId: r.task_id, dependsOnId: r.depends_on_id }));
}
