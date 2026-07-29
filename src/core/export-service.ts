// Board Export/Import als ZIP-Archiv
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { $ } from "bun";
import type { Database } from "bun:sqlite";
import { openDb, createSchema, boardExists, getBoardPaths, loadBoardConfig } from "./db.ts";
import { TARGET_SCHEMA_VERSION, deriveColumnConfigs, type LegacyColumnRow } from "./migrate-v3.ts";
import { BoardService } from "./board-service.ts";
import { TaskService } from "./task-service.ts";
import { NotesService } from "./notes-service.ts";
import type { BoardConfig, ColumnConfig, Task, Transition, TransitionRow } from "./types.ts";
import { rowToTransition, validateBoardConfig } from "./types.ts";

// Export-Format-Version (nicht identisch mit der DB-Schema-Version, auch wenn
// beide aktuell zufaellig '3' sind — siehe TARGET_SCHEMA_VERSION fuer die DB).
const EXPORT_VERSION = 3;
// Aelteste noch unterstuetzte Import-Version. v2-Archive existieren bereits
// (vor der Schema-v3-Migration erzeugt) — Rueckwaerts-Kompatibilitaet ist
// Pflicht, kein optionales Feature (P0-6).
const MIN_IMPORT_VERSION = 2;

// Export-Datenstruktur in board.json (v3). 'columns': geordnetes Array ohne
// 'position'-Feld, analog zu config.json (ADR 0001) — bewusst zusaetzlich zum
// bereits in 'config' enthaltenen 'columns'-Feld: ein Export ist ein
// vollstaendiger, eigenstaendig lesbarer Snapshot, auch wenn die Quelle seit
// Schema v3 config.json ist.
interface BoardExport {
  version: number;
  exportedAt: string;
  config: BoardConfig;
  columns: ColumnConfig[];
  tasks: Task[];
  dependencies: Array<{ taskId: string; dependsOnId: string }>;
  transitions: Transition[];
}

// Rohformat eines v2-Exports (vor Schema v3/ADR 0001). 'columns' hat noch
// 'position' statt 'allowEntry', 'config' kennt weder 'schemaVersion' noch
// 'columns'. Tasks kennen weder priority/dueDate (Paket 0) noch Transitions
// (Paket 1) — fehlen hier bewusst, statt sie fael­schlich als vorhanden zu
// typisieren.
interface LegacyColumnExport {
  id: string;
  name: string;
  position: number;
  wipLimit: number;
  isTerminal: boolean;
}

interface LegacyTaskExport {
  id: string;
  title: string;
  description: string | null;
  columnId: string;
  createdBy: string;
  assignedTo: string | null;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  version: number;
  position: number;
}

interface LegacyBoardExport {
  version: number;
  exportedAt: string;
  config: { name: string; createdAt: string };
  columns: LegacyColumnExport[];
  tasks: LegacyTaskExport[];
  dependencies: Array<{ taskId: string; dependsOnId: string }>;
}

// Ergebnis eines Imports — fuers CLI/MCP zur Anzeige. 'note' ist nur bei
// einer v2-Quelle gesetzt (Spalten-Uebersetzung soll sichtbar sein); bei v3
// gibt es nichts Besonderes zu melden. Analog zu MigrationReport
// (migrate-v3.ts): der Service liefert Daten zurueck statt selbst zu loggen,
// die Praesentation macht der Aufrufer (CLI/MCP).
export interface ImportReport {
  sourceVersion: number;
  note: string | null;
}

// Board als ZIP exportieren — gibt den Pfad zur ZIP-Datei zurueck
export async function exportBoard(workingDir: string, outputPath?: string): Promise<string> {
  if (!boardExists(workingDir)) {
    throw new Error("Kein Board gefunden. Zuerst 'kanban init' ausfuehren.");
  }

  const paths = getBoardPaths(workingDir);
  // openDb() prueft die Schema-Version (P0-5) — ein v2-Board wirft hier ab,
  // bevor irgendetwas geschrieben wird.
  const db = openDb(paths.dbPath);
  const config: BoardConfig = loadBoardConfig(paths.configPath);
  const boardService = new BoardService(db, config);
  const notesService = new NotesService(paths.kanbanDir);
  const taskService = new TaskService(db, boardService, notesService);

  // Alle Daten sammeln
  const tasks = taskService.listTasks({ includeArchived: true });
  const dependencies = getAllDependencies(db);
  const transitions = getAllTransitions(db);

  const exportData: BoardExport = {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    config,
    columns: config.columns,
    tasks,
    dependencies,
    transitions,
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
export async function importBoard(
  workingDir: string,
  zipPath: string,
  options?: { force?: boolean },
): Promise<ImportReport> {
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

    // board.json lesen und Version bestimmen
    const boardJsonPath = join(tmpDir, "board.json");
    if (!existsSync(boardJsonPath)) {
      throw new Error("Ungueltige ZIP-Datei: board.json fehlt");
    }
    const raw = JSON.parse(readFileSync(boardJsonPath, "utf-8")) as { version?: number };
    const version = raw.version;

    if (typeof version !== "number" || version < MIN_IMPORT_VERSION || version > EXPORT_VERSION) {
      throw new Error(
        `Inkompatible Schema-Version: ${version} (unterstuetzt: ${MIN_IMPORT_VERSION} bis ${EXPORT_VERSION})`,
      );
    }

    const kanbanDir = join(workingDir, ".kanban");
    mkdirSync(kanbanDir, { recursive: true });

    const note =
      version === MIN_IMPORT_VERSION
        ? importLegacyV2(kanbanDir, raw as unknown as LegacyBoardExport)
        : importCurrentV3(kanbanDir, raw as unknown as BoardExport);

    // Notes kopieren (fuer v2 und v3 identisch)
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

    return { sourceVersion: version, note };
  } finally {
    // Aufraeumen
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  }
}

// v3-Import: 'columns' unveraendert uebernehmen (Reihenfolge nicht neu
// sortieren, kein 'position'-Feld), Transitions sowie priority/dueDate mit
// einspielen. KEIN sourceId: das Feld wurde nach P0-3 gestrichen, weil
// TodoWrite kein 'id'-Feld liefert (Plan Abschnitt 0.1) — ein Import kennt es
// folglich auch nicht.
function importCurrentV3(kanbanDir: string, data: BoardExport): null {
  // Config inklusive Spalten und schemaVersion schreiben, per
  // validateBoardConfig geprueft, BEVOR das Board als fertig gilt (schuetzt
  // vor einem strukturell kaputten/manipulierten Archiv).
  const config = validateBoardConfig({
    name: data.config.name,
    createdAt: data.config.createdAt,
    schemaVersion: TARGET_SCHEMA_VERSION,
    columns: data.columns,
  });
  writeFileSync(join(kanbanDir, "config.json"), JSON.stringify(config, null, 2));

  const dbPath = join(kanbanDir, "board.db");
  const db = openDb(dbPath);
  createSchema(db);

  const taskIds = new Set(data.tasks.map((t) => t.id));
  insertTasks(db, data.tasks);
  insertDependencies(db, data.dependencies, taskIds);
  insertTransitions(db, data.transitions ?? [], taskIds);

  db.close();
  return null;
}

// v2-Import (Pflicht, Rueckwaerts-Kompatibilitaet): es existieren bereits
// v2-ZIPs aus der Zeit vor der Migration. Ein v2-Archiv landet direkt als
// v3-Board — 'kanban migrate' ist danach nicht noetig. Spalten-Uebersetzung
// identisch zu migrate-v3.ts/deriveColumnConfigs (P0-4, gleiche Funktion,
// keine zweite Implementierung): nach 'position' sortieren, Array-Reihenfolge
// wird zur Ordnung, 'position'-Feld faellt weg, die ersten beiden Spalten
// werden Eintrittsspalten. transitions/priority/dueDate kennt v2 nicht — die
// Tabelle bleibt leer, die Felder werden NULL.
function importLegacyV2(kanbanDir: string, data: LegacyBoardExport): string {
  const sortedColumns = [...data.columns].sort((a, b) => a.position - b.position);
  const legacyRows: LegacyColumnRow[] = sortedColumns.map((c) => ({
    id: c.id,
    name: c.name,
    position: c.position,
    wip_limit: c.wipLimit,
    is_terminal: c.isTerminal ? 1 : 0,
  }));
  const columns = deriveColumnConfigs(legacyRows);

  const config = validateBoardConfig({
    name: data.config.name,
    createdAt: data.config.createdAt,
    schemaVersion: TARGET_SCHEMA_VERSION,
    columns,
  });
  writeFileSync(join(kanbanDir, "config.json"), JSON.stringify(config, null, 2));

  const dbPath = join(kanbanDir, "board.db");
  const db = openDb(dbPath);
  createSchema(db);

  const legacyTasks: Task[] = data.tasks.map((t) => ({ ...t, priority: null, dueDate: null }));
  const taskIds = new Set(legacyTasks.map((t) => t.id));
  insertTasks(db, legacyTasks);
  insertDependencies(db, data.dependencies, taskIds);
  // transitions: v2 kennt sie nicht — Tabelle bleibt leer (kein insertTransitions-Aufruf).

  db.close();

  const entryIds = columns.filter((c) => c.allowEntry).map((c) => c.id).join(", ");
  return `v2-Archiv importiert, Spalten nach config.json uebernommen, Eintrittsspalten: ${entryIds}`;
}

// Tasks einfuegen — gemeinsam fuer v2- und v3-Import. v2-Tasks werden vom
// Aufrufer vorher auf priority/dueDate: null normalisiert (v2 kennt diese
// Felder nicht, siehe importLegacyV2).
function insertTasks(db: Database, tasks: Task[]): void {
  const insertTask = db.prepare(
    `INSERT INTO tasks (
       id, title, description, column_id, created_by, assigned_to, labels,
       position, created_at, updated_at, archived, version, priority, due_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const task of tasks) {
    insertTask.run(
      task.id, task.title, task.description,
      task.columnId, task.createdBy, task.assignedTo,
      task.labels && task.labels.length > 0 ? JSON.stringify(task.labels) : null,
      task.position, task.createdAt, task.updatedAt,
      task.archived ? 1 : 0, task.version,
      task.priority ?? null, task.dueDate ?? null,
    );
  }
}

// Dependencies einfuegen — nur zwischen tatsaechlich importierten Tasks
// (schuetzt vor einem kaputten/manipulierten Archiv mit verwaisten IDs).
function insertDependencies(
  db: Database,
  dependencies: Array<{ taskId: string; dependsOnId: string }>,
  taskIds: Set<string>,
): void {
  const insertDep = db.prepare(
    "INSERT OR IGNORE INTO dependencies (task_id, depends_on_id) VALUES (?, ?)"
  );
  for (const dep of dependencies) {
    if (taskIds.has(dep.taskId) && taskIds.has(dep.dependsOnId)) {
      insertDep.run(dep.taskId, dep.dependsOnId);
    }
  }
}

// Transitions einfuegen — nur v3-Quellen kennen sie; gleiche
// Existenz-Pruefung wie bei Dependencies.
function insertTransitions(db: Database, transitions: Transition[], taskIds: Set<string>): void {
  const insertTransition = db.prepare(
    `INSERT INTO transitions (task_id, from_column, to_column, reported_by, reason, was_override, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const t of transitions) {
    if (!taskIds.has(t.taskId)) continue;
    insertTransition.run(
      t.taskId, t.fromColumn, t.toColumn, t.reportedBy,
      t.reason, t.wasOverride ? 1 : 0, t.createdAt,
    );
  }
}

// Alle Dependencies aus der DB lesen
function getAllDependencies(db: Database): Array<{ taskId: string; dependsOnId: string }> {
  const rows = db.query("SELECT task_id, depends_on_id FROM dependencies").all() as Array<{
    task_id: string;
    depends_on_id: string;
  }>;
  return rows.map(r => ({ taskId: r.task_id, dependsOnId: r.depends_on_id }));
}

// Alle Transitions aus der DB lesen, chronologisch nach Einfuegereihenfolge (id)
function getAllTransitions(db: Database): Transition[] {
  const rows = db.query("SELECT * FROM transitions ORDER BY id ASC").all() as TransitionRow[];
  return rows.map(rowToTransition);
}
