/**
 * ABOUTME: Typen fuer Kanban MCP CLI Output und Plugin-Konfiguration.
 * Definiert das JSON-Format das die Kanban CLI zurueckgibt.
 */

/** Kanban Board Spalten */
export type KanbanColumn = 'backlog' | 'todo' | 'in-progress' | 'review' | 'done';

/** Einzelner Task wie ihn die Kanban CLI als JSON ausgibt */
export interface KanbanTask {
  id: string;
  title: string;
  description: string | null;
  columnId: KanbanColumn;
  labels: string[];
  assignedTo: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  position: number;
  archived: boolean;
  version: number;
  hasNotes: boolean;
  isBlocked: boolean;
  notes?: string | null;
}

/** Kanban Board Status wie ihn `kanban status` ausgibt */
export interface KanbanStatus {
  board: string;
  columns: Record<string, number>;
  total: number;
}

/** Plugin-Konfiguration — wird von Ralph TUI uebergeben */
export interface PluginConfig {
  kanbanBin: string;
  projectDir: string;
}

/** Ergebnis eines CLI-Aufrufs */
export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// --- Ralph TUI TrackerPlugin Types ---
// Lokal definiert weil Ralph Types nicht importierbar sind (gebundelt)

/** Plugin-Metadaten fuer Ralph TUI Registry */
export interface TrackerPluginMeta {
  id: string;
  name: string;
  description: string;
  version: string;
  supportsBidirectionalSync: boolean;
  supportsHierarchy: boolean;
  supportsDependencies: boolean;
}

/** Ergebnis einer Task-Completion */
export interface TaskCompletionResult {
  success: boolean;
  task?: import('./mapping').TrackerTask;
  message?: string;
  error?: string;
}

/** Sync-Ergebnis */
export interface SyncResult {
  success: boolean;
  message: string;
  syncedAt: string;
}

/** Setup-Frage fuer Konfiguration */
export interface SetupQuestion {
  id: string;
  label: string;
  type: 'text' | 'password' | 'confirm';
  default?: string;
  required?: boolean;
}

/** Task-Filter fuer Queries */
export interface TaskFilter {
  status?: import('./mapping').TrackerTaskStatus[];
  labels?: string[];
  excludeIds?: string[];
}
