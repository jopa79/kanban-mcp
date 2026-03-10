// Basis-Typen fuer das Kanban Board

export interface Column {
  id: string;
  name: string;
  position: number;
  wipLimit: number;
  isTerminal: boolean;
}

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
  notes?: string | null;
  hasNotes?: boolean;
  isBlocked?: boolean;
}

export interface BoardConfig {
  name: string;
  createdAt: string;
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
}

export interface ColumnRow {
  id: string;
  name: string;
  position: number;
  wip_limit: number;
  is_terminal: number;
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
  };
}

export function rowToColumn(row: ColumnRow): Column {
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    wipLimit: row.wip_limit,
    isTerminal: row.is_terminal === 1,
  };
}
