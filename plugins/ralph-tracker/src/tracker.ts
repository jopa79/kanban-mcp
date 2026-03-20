/**
 * ABOUTME: KanbanMcpTracker — TrackerPlugin Implementation fuer Ralph TUI.
 * Orchestriert CLI-Aufrufe und Mapping um Kanban Tasks als Ralph Tasks bereitzustellen.
 * Factory-Export als Default fuer das Plugin-System.
 */

import { kanbanList, kanbanGet, kanbanMove, kanbanStatus } from './cli';
import { toTrackerTask, toColumnId, sortForNextTask } from './mapping';
import type { TrackerTask, TrackerTaskStatus } from './mapping';
import type {
  PluginConfig,
  KanbanColumn,
  TrackerPluginMeta,
  TaskCompletionResult,
  SyncResult,
  SetupQuestion,
  TaskFilter,
} from './types';
import { PROMPT_TEMPLATE } from './template';

/** Spalten die als "offene Tasks" geladen werden */
const ACTIVE_COLUMNS: KanbanColumn[] = ['todo', 'in-progress', 'backlog'];

/**
 * Kanban MCP Tracker Plugin fuer Ralph TUI.
 * Kommuniziert mit der Kanban CLI via Subprocess und mappt Tasks
 * in das TrackerTask-Format.
 */
export class KanbanMcpTracker {
  readonly meta: TrackerPluginMeta = {
    id: 'kanban-mcp',
    name: 'Kanban MCP Tracker',
    description: 'Tracks tasks via Kanban MCP CLI',
    version: '0.1.0',
    supportsBidirectionalSync: true,
    supportsHierarchy: false,
    supportsDependencies: false,
  };

  private config: PluginConfig | null = null;
  private ready = false;

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = {
      kanbanBin: (config.kanbanBin as string) ?? '/opt/homebrew/bin/kanban',
      projectDir: (config.projectDir as string) ?? '.',
    };
    const status = await kanbanStatus(this.config);
    this.ready = status !== null;
  }

  async isReady(): Promise<boolean> { return this.ready; }
  async dispose(): Promise<void> { /* No-op */ }

  async getTasks(filter?: TaskFilter): Promise<TrackerTask[]> {
    if (!this.config) return [];

    const allTasks: TrackerTask[] = [];
    for (const column of ACTIVE_COLUMNS) {
      const kanbanTasks = await kanbanList(this.config, column);
      allTasks.push(...kanbanTasks.map(toTrackerTask));
    }

    let result = allTasks;
    if (filter?.status) {
      result = result.filter(t => filter.status!.includes(t.status));
    }
    if (filter?.labels) {
      result = result.filter(t => filter.labels!.every(l => t.labels?.includes(l)));
    }
    if (filter?.excludeIds) {
      const ex = new Set(filter.excludeIds);
      result = result.filter(t => !ex.has(t.id));
    }
    return result;
  }

  async getTask(id: string): Promise<TrackerTask | undefined> {
    if (!this.config) return undefined;
    const kanbanTask = await kanbanGet(this.config, id);
    return kanbanTask ? toTrackerTask(kanbanTask) : undefined;
  }

  async getNextTask(filter?: TaskFilter): Promise<TrackerTask | undefined> {
    const tasks = await this.getTasks({
      ...filter,
      status: filter?.status ?? ['open', 'in_progress'],
    });
    if (tasks.length === 0) return undefined;
    return sortForNextTask(tasks)[0];
  }

  async getEpics(): Promise<TrackerTask[]> { return []; }

  async completeTask(id: string, _reason?: string): Promise<TaskCompletionResult> {
    if (!this.config) return { success: false, message: 'Plugin nicht initialisiert' };

    const moved = await kanbanMove(this.config, id, 'review');
    if (!moved) return { success: false, message: `Task ${id} konnte nicht verschoben werden` };

    const task = await this.getTask(id);
    return { success: true, message: `Task ${id} nach Review verschoben`, task };
  }

  async updateTaskStatus(id: string, status: TrackerTaskStatus): Promise<TrackerTask | undefined> {
    if (!this.config) return undefined;
    const column = toColumnId(status);
    const moved = await kanbanMove(this.config, id, column);
    return moved ? this.getTask(id) : undefined;
  }

  async isComplete(filter?: TaskFilter): Promise<boolean> {
    return (await this.getTasks(filter)).length === 0;
  }

  async isTaskReady(_id: string): Promise<boolean> { return true; }

  async sync(): Promise<SyncResult> {
    return { success: true, message: 'Data is always fresh from CLI', syncedAt: new Date().toISOString() };
  }

  getSetupQuestions(): SetupQuestion[] {
    return [
      { id: 'kanbanBin', label: 'Path to kanban binary', type: 'text', default: '/opt/homebrew/bin/kanban', required: true },
      { id: 'projectDir', label: 'Project directory (with .kanban/ folder)', type: 'text', default: '.', required: true },
    ];
  }

  async validateSetup(answers: Record<string, unknown>): Promise<string | null> {
    const kanbanBin = answers.kanbanBin as string;
    try {
      if (!(await Bun.file(kanbanBin).exists())) return `Kanban Binary nicht gefunden: ${kanbanBin}`;
    } catch { return `Kanban Binary nicht zugreifbar: ${kanbanBin}`; }
    return null;
  }

  getTemplate(): string { return PROMPT_TEMPLATE; }
}

/** Factory-Funktion fuer das Ralph TUI Plugin-System */
export default function factory(): KanbanMcpTracker {
  return new KanbanMcpTracker();
}
