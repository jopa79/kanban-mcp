/**
 * ABOUTME: Tests fuer Kanban→TrackerTask Mapping und Sortierung.
 * Prueft Status-Konvertierung, Rueckweg-Mapping und getNextTask-Sortierlogik.
 */

import { describe, it, expect } from 'bun:test';
import { toTrackerTask, toColumnId, sortForNextTask } from '../src/mapping';
import type { KanbanTask } from '../src/types';

// Hilfsfunktion: minimalen KanbanTask erstellen
function makeKanbanTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: 'test-id-123',
    title: 'Test Task',
    description: null,
    columnId: 'todo',
    labels: [],
    assignedTo: null,
    createdBy: 'test',
    createdAt: '2026-03-19T10:00:00.000Z',
    updatedAt: '2026-03-19T10:00:00.000Z',
    position: 0,
    archived: false,
    version: 1,
    hasNotes: false,
    isBlocked: false,
    ...overrides,
  };
}

describe('toTrackerTask', () => {
  it('konvertiert todo → open', () => {
    const task = toTrackerTask(makeKanbanTask({ columnId: 'todo' }));
    expect(task.status).toBe('open');
  });

  it('konvertiert in-progress → in_progress', () => {
    const task = toTrackerTask(makeKanbanTask({ columnId: 'in-progress' }));
    expect(task.status).toBe('in_progress');
  });

  it('konvertiert backlog → blocked', () => {
    const task = toTrackerTask(makeKanbanTask({ columnId: 'backlog' }));
    expect(task.status).toBe('blocked');
  });

  it('konvertiert review → completed', () => {
    const task = toTrackerTask(makeKanbanTask({ columnId: 'review' }));
    expect(task.status).toBe('completed');
  });

  it('mappt ID, Title, Labels korrekt', () => {
    const task = toTrackerTask(makeKanbanTask({
      id: 'abc-123',
      title: 'Mein Task',
      labels: ['urgent', 'frontend'],
    }));
    expect(task.id).toBe('abc-123');
    expect(task.title).toBe('Mein Task');
    expect(task.labels).toEqual(['urgent', 'frontend']);
  });

  it('mappt Description', () => {
    const task = toTrackerTask(makeKanbanTask({
      description: 'Beschreibung hier',
    }));
    expect(task.description).toBe('Beschreibung hier');
  });

  it('setzt priority auf 0 (Kanban hat keine Prioritaeten)', () => {
    const task = toTrackerTask(makeKanbanTask());
    expect(task.priority).toBe(0);
  });

  it('setzt type auf task', () => {
    const task = toTrackerTask(makeKanbanTask());
    expect(task.type).toBe('task');
  });

  it('packt Notes in metadata.notes', () => {
    const task = toTrackerTask(makeKanbanTask({
      notes: '# Wichtige Notiz\nDetails hier',
    }));
    expect(task.metadata?.notes).toBe('# Wichtige Notiz\nDetails hier');
  });

  it('hat nur position in metadata wenn keine Notes', () => {
    const task = toTrackerTask(makeKanbanTask({ notes: null, position: 5 }));
    expect(task.metadata).toEqual({ position: 5 });
    expect(task.metadata?.notes).toBeUndefined();
  });

  it('mappt Timestamps', () => {
    const task = toTrackerTask(makeKanbanTask({
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    }));
    expect(task.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(task.updatedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('behandelt unbekannte columnId als open', () => {
    // Safety: falls ein unbekannter Status kommt
    const task = toTrackerTask(makeKanbanTask({ columnId: 'unknown' as any }));
    expect(task.status).toBe('open');
  });
});

describe('toColumnId', () => {
  it('open → todo', () => {
    expect(toColumnId('open')).toBe('todo');
  });

  it('in_progress → in-progress', () => {
    expect(toColumnId('in_progress')).toBe('in-progress');
  });

  it('completed → review', () => {
    expect(toColumnId('completed')).toBe('review');
  });

  it('blocked → backlog', () => {
    expect(toColumnId('blocked')).toBe('backlog');
  });

  it('cancelled → backlog', () => {
    expect(toColumnId('cancelled')).toBe('backlog');
  });
});

describe('sortForNextTask', () => {
  it('sortiert meta+plan Labels zuerst', () => {
    const tasks = [
      toTrackerTask(makeKanbanTask({ id: 'normal', title: 'Normal', labels: ['core'], columnId: 'todo' })),
      toTrackerTask(makeKanbanTask({ id: 'meta', title: 'LIES MICH', labels: ['meta', 'plan'], columnId: 'todo' })),
    ];

    const sorted = sortForNextTask(tasks);
    expect(sorted[0].id).toBe('meta');
  });

  it('sortiert in_progress vor open', () => {
    const tasks = [
      toTrackerTask(makeKanbanTask({ id: 'open1', title: 'Open', columnId: 'todo' })),
      toTrackerTask(makeKanbanTask({ id: 'wip1', title: 'WIP', columnId: 'in-progress' })),
    ];

    const sorted = sortForNextTask(tasks);
    expect(sorted[0].id).toBe('wip1');
  });

  it('behaelt Position bei gleicher Prioritaet', () => {
    const tasks = [
      toTrackerTask(makeKanbanTask({ id: 'a', title: 'A', position: 0, columnId: 'todo' })),
      toTrackerTask(makeKanbanTask({ id: 'b', title: 'B', position: 1, columnId: 'todo' })),
      toTrackerTask(makeKanbanTask({ id: 'c', title: 'C', position: 2, columnId: 'todo' })),
    ];

    const sorted = sortForNextTask(tasks);
    expect(sorted.map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('kombiniert alle Sortierregeln korrekt', () => {
    const tasks = [
      toTrackerTask(makeKanbanTask({ id: 'todo-2', title: 'Todo 2', position: 1, columnId: 'todo' })),
      toTrackerTask(makeKanbanTask({ id: 'wip-1', title: 'WIP', position: 0, columnId: 'in-progress' })),
      toTrackerTask(makeKanbanTask({ id: 'meta-1', title: 'META', labels: ['meta', 'plan'], position: 2, columnId: 'todo' })),
      toTrackerTask(makeKanbanTask({ id: 'todo-1', title: 'Todo 1', position: 0, columnId: 'todo' })),
    ];

    const sorted = sortForNextTask(tasks);
    // 1. meta+plan zuerst, 2. in_progress, 3. position
    expect(sorted.map(t => t.id)).toEqual(['meta-1', 'wip-1', 'todo-1', 'todo-2']);
  });

  it('gibt leeres Array bei leerem Input', () => {
    expect(sortForNextTask([])).toEqual([]);
  });
});
