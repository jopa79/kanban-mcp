/**
 * ABOUTME: Mapping zwischen Kanban MCP Tasks und Ralph TrackerTask Format.
 * Konvertiert Spalten zu Status, sortiert fuer getNextTask-Priorisierung.
 */

import type { KanbanTask, KanbanColumn } from './types';

/** Ralph TrackerTask Status */
export type TrackerTaskStatus = 'open' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';

/** Ralph TrackerTask — vereinfachte Version des Interfaces */
export interface TrackerTask {
  id: string;
  title: string;
  status: TrackerTaskStatus;
  priority: 0 | 1 | 2 | 3 | 4;
  description?: string;
  labels?: string[];
  type?: string;
  assignee?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

/** Kanban Column → Ralph Status Mapping */
const COLUMN_TO_STATUS: Record<string, TrackerTaskStatus> = {
  'todo': 'open',
  'in-progress': 'in_progress',
  'backlog': 'blocked',
  'review': 'completed',
  'done': 'completed',
};

/** Ralph Status → Kanban Column Mapping */
const STATUS_TO_COLUMN: Record<TrackerTaskStatus, KanbanColumn> = {
  'open': 'todo',
  'in_progress': 'in-progress',
  'completed': 'review',
  'blocked': 'backlog',
  'cancelled': 'backlog',
};

/**
 * Konvertiert einen Kanban Task in das Ralph TrackerTask Format.
 */
export function toTrackerTask(kanbanTask: KanbanTask): TrackerTask {
  const status = COLUMN_TO_STATUS[kanbanTask.columnId] ?? 'open';

  const task: TrackerTask = {
    id: kanbanTask.id,
    title: kanbanTask.title,
    status,
    priority: 0,
    type: 'task',
    labels: kanbanTask.labels.length > 0 ? kanbanTask.labels : undefined,
    createdAt: kanbanTask.createdAt,
    updatedAt: kanbanTask.updatedAt,
  };

  // Description nur setzen wenn vorhanden
  if (kanbanTask.description) {
    task.description = kanbanTask.description;
  }

  // Assignee nur setzen wenn vorhanden
  if (kanbanTask.assignedTo) {
    task.assignee = kanbanTask.assignedTo;
  }

  // Metadata: Position und Notes
  const metadata: Record<string, unknown> = { position: kanbanTask.position };
  if (kanbanTask.notes) {
    metadata.notes = kanbanTask.notes;
  }
  task.metadata = metadata;

  return task;
}

/**
 * Konvertiert Ralph TrackerTaskStatus zurueck zu einer Kanban Column ID.
 */
export function toColumnId(status: TrackerTaskStatus): KanbanColumn {
  return STATUS_TO_COLUMN[status];
}

/**
 * Sortiert Tasks fuer getNextTask() Priorisierung:
 * 1. Tasks mit Labels meta + plan zuerst (LIES MICH ZUERST)
 * 2. in_progress vor open (angefangene Tasks zuerst fertigmachen)
 * 3. Innerhalb gleicher Prioritaet: Position im Board
 */
export function sortForNextTask(tasks: TrackerTask[]): TrackerTask[] {
  if (tasks.length === 0) return [];

  return [...tasks].sort((a, b) => {
    // 1. meta+plan Labels zuerst
    const aIsMeta = hasMetaPlanLabels(a);
    const bIsMeta = hasMetaPlanLabels(b);
    if (aIsMeta && !bIsMeta) return -1;
    if (!aIsMeta && bIsMeta) return 1;

    // 2. in_progress vor open
    const aIsWip = a.status === 'in_progress' ? 0 : 1;
    const bIsWip = b.status === 'in_progress' ? 0 : 1;
    if (aIsWip !== bIsWip) return aIsWip - bIsWip;

    // 3. Position im Board (aus metadata.position)
    const aPos = (a.metadata?.position as number) ?? 0;
    const bPos = (b.metadata?.position as number) ?? 0;
    return aPos - bPos;
  });
}

/** Prueft ob ein Task die Labels meta UND plan hat */
function hasMetaPlanLabels(task: TrackerTask): boolean {
  if (!task.labels) return false;
  return task.labels.includes('meta') && task.labels.includes('plan');
}
