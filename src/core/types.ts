// Basis-Typen fuer das Kanban Board

// Domain-Objekt einer Spalte. 'position' wird beim Laden aus dem Index im
// config.columns-Array abgeleitet und nie aus der Datei gelesen (siehe
// ColumnConfig und ADR 0001).
export interface Column {
  id: string;
  name: string;
  position: number;
  wipLimit: number;
  allowEntry: boolean;
  isTerminal: boolean;
}

// Prioritaet eines Tasks — echte, sortierbare Spalte seit Schema v3 (Paket 0).
// Durchreichen ueber CLI/MCP/TUI kommt erst in Paket 2 (Metadaten).
export type TaskPriority = "high" | "medium" | "low";

export interface Task {
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
  priority: TaskPriority | null;
  dueDate: string | null;
  notes?: string | null;
  hasNotes?: boolean;
  isBlocked?: boolean;
}

// Spalten-Definition wie sie in config.json steht — bewusst OHNE 'position'.
// Die Array-Reihenfolge in BoardConfig.columns IST die Reihenfolge (ADR 0001).
export interface ColumnConfig {
  id: string;
  name: string;
  wipLimit: number;
  allowEntry: boolean;
  isTerminal: boolean;
}

export interface BoardConfig {
  name: string;
  createdAt: string;
  schemaVersion: number;
  columns: ColumnConfig[];
}

// Input-Typen fuer Operationen

export interface AddTaskInput {
  title: string;
  description?: string;
  columnId?: string;
  createdBy?: string;
  assignedTo?: string;
  labels?: string[];
  dependsOn?: string[];
  notes?: string;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  assignedTo?: string | null;
  labels?: string[];
  notes?: string | null;
}

export interface ListTasksFilter {
  columnId?: string;
  createdBy?: string;
  assignedTo?: string;
  includeArchived?: boolean;
}

export interface AddTaskCheckedResult {
  task: Task | null;
  rejected: boolean;
  rejectionReason: string | null;
  similarTasks: Task[];
}

// Datenbank-Row Typen (wie SQLite sie liefert)

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  column_id: string;
  created_by: string;
  assigned_to: string | null;
  labels: string | null;
  created_at: string;
  updated_at: string;
  archived: number;
  version: number;
  position: number;
  priority: string | null;
  due_date: string | null;
}

// Hilfsfunktionen: DB-Row -> Domain-Objekt

export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    columnId: row.column_id,
    createdBy: row.created_by,
    assignedTo: row.assigned_to,
    labels: row.labels ? JSON.parse(row.labels) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archived: row.archived === 1,
    version: row.version,
    position: row.position ?? 0,
    priority: (row.priority as TaskPriority | null) ?? null,
    dueDate: row.due_date ?? null,
  };
}

// Zustandsuebergang eines Tasks (Schema v3, Paket 0). Wird ab Paket 1
// (transition-service.ts) befuellt — hier nur Typ und Row-Mapping, analog zu
// Task/TaskRow/rowToTask. Siehe Plan Abschnitt 2.1 und Kanban-Task N8-B1V7SnbFx.
export interface Transition {
  id: number;
  taskId: string;
  fromColumn: string | null; // NULL = Task-Entstehung
  toColumn: string;
  reportedBy: string;
  reason: string | null;
  wasOverride: boolean;
  createdAt: string;
}

export interface TransitionRow {
  id: number;
  task_id: string;
  from_column: string | null;
  to_column: string;
  reported_by: string;
  reason: string | null;
  was_override: number;
  created_at: string;
}

export function rowToTransition(row: TransitionRow): Transition {
  return {
    id: row.id,
    taskId: row.task_id,
    fromColumn: row.from_column,
    toColumn: row.to_column,
    reportedBy: row.reported_by,
    reason: row.reason,
    wasOverride: row.was_override === 1,
    createdAt: row.created_at,
  };
}

// Validiert eine rohe config.json-Struktur und liefert eine typsichere BoardConfig.
// Wirft bei jedem Fehler eine verstaendliche Meldung auf Deutsch — der Pfad zur
// Datei wird hier bewusst NICHT ergaenzt (validateBoardConfig kennt den Pfad
// nicht), das macht der Aufrufer (siehe loadBoardConfig in db.ts).
export function validateBoardConfig(raw: unknown): BoardConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("config.json: Inhalt ist kein Objekt");
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.name !== "string") {
    throw new Error("config.json: Feld 'name' fehlt oder ist kein String");
  }
  if (typeof obj.createdAt !== "string") {
    throw new Error("config.json: Feld 'createdAt' fehlt oder ist kein String");
  }
  if (typeof obj.schemaVersion !== "number") {
    throw new Error("config.json: Feld 'schemaVersion' fehlt oder ist keine Zahl");
  }
  if (!Array.isArray(obj.columns)) {
    throw new Error("config.json: Feld 'columns' fehlt oder ist kein Array");
  }
  if (obj.columns.length === 0) {
    throw new Error("config.json: 'columns' ist leer — mindestens eine Spalte noetig");
  }

  const columns: ColumnConfig[] = obj.columns.map((rawCol, index) =>
    validateColumnConfig(rawCol, index),
  );

  const ids = new Set<string>();
  for (const col of columns) {
    if (ids.has(col.id)) {
      throw new Error(`config.json: doppelte Spalten-id '${col.id}'`);
    }
    ids.add(col.id);
  }

  const terminalColumns = columns.filter((c) => c.isTerminal);
  if (terminalColumns.length === 0) {
    throw new Error("config.json: keine Spalte mit isTerminal: true — es muss genau eine geben");
  }
  if (terminalColumns.length > 1) {
    const names = terminalColumns.map((c) => c.id).join(", ");
    throw new Error(
      `config.json: mehrere Spalten mit isTerminal: true (${names}) — es darf genau eine geben`,
    );
  }

  if (!columns.some((c) => c.allowEntry)) {
    throw new Error(
      "config.json: keine Spalte mit allowEntry: true — mindestens eine Eintrittsspalte noetig",
    );
  }

  return {
    name: obj.name,
    createdAt: obj.createdAt,
    schemaVersion: obj.schemaVersion,
    columns,
  };
}

// Validiert ein einzelnes rohes Spaltenobjekt aus config.json.
function validateColumnConfig(raw: unknown, index: number): ColumnConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`config.json: Spalte an Index ${index} ist kein Objekt`);
  }
  const col = raw as Record<string, unknown>;

  if (typeof col.id !== "string" || col.id.length === 0) {
    throw new Error(`config.json: Spalte an Index ${index} hat keine gueltige 'id'`);
  }
  if (typeof col.name !== "string" || col.name.length === 0) {
    throw new Error(`config.json: Spalte '${col.id}' hat keinen gueltigen 'name'`);
  }
  if (typeof col.wipLimit !== "number") {
    throw new Error(`config.json: Spalte '${col.id}' hat kein gueltiges 'wipLimit'`);
  }
  if (typeof col.allowEntry !== "boolean") {
    throw new Error(`config.json: Spalte '${col.id}' hat kein gueltiges 'allowEntry'`);
  }
  if (typeof col.isTerminal !== "boolean") {
    throw new Error(`config.json: Spalte '${col.id}' hat kein gueltiges 'isTerminal'`);
  }
  // 'position' entfaellt bewusst (ADR 0001) — die Array-Reihenfolge ist die Ordnung.
  // Ein vorhandenes Feld in der Datei ist ein Fehler, kein ignoriertes Extra, sonst
  // glaubt jemand, es haette eine Wirkung.
  if ("position" in col) {
    throw new Error(
      `config.json: Spalte '${col.id}' enthaelt ein 'position'-Feld — die Reihenfolge ` +
      "im Array ist die Position, ein eigenes Feld wird ignoriert und ist deshalb ein Fehler",
    );
  }

  return {
    id: col.id,
    name: col.name,
    wipLimit: col.wipLimit,
    allowEntry: col.allowEntry,
    isTerminal: col.isTerminal,
  };
}
