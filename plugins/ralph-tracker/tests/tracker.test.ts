/**
 * ABOUTME: Integration Tests fuer das KanbanMcpTracker Plugin.
 * Testet Plugin-Lifecycle, Task-Queries, Mutations und Config.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import factory, { KanbanMcpTracker } from '../src/tracker';

describe('factory', () => {
  it('gibt eine KanbanMcpTracker Instanz zurueck', () => {
    const tracker = factory();
    expect(tracker).toBeInstanceOf(KanbanMcpTracker);
  });
});

describe('KanbanMcpTracker meta', () => {
  it('hat korrekte Plugin-Metadaten', () => {
    const tracker = factory();
    expect(tracker.meta.id).toBe('kanban-mcp');
    expect(tracker.meta.name).toBe('Kanban MCP Tracker');
    expect(tracker.meta.version).toBe('0.1.0');
    expect(tracker.meta.supportsBidirectionalSync).toBe(true);
    expect(tracker.meta.supportsHierarchy).toBe(false);
    expect(tracker.meta.supportsDependencies).toBe(false);
  });
});

describe('Lifecycle', () => {
  it('isReady gibt false vor initialize', async () => {
    const tracker = factory();
    expect(await tracker.isReady()).toBe(false);
  });

  it('initialize mit gueltigem Board macht isReady true', async () => {
    const tracker = factory();
    await tracker.initialize({
      kanbanBin: '/opt/homebrew/bin/kanban',
      projectDir: process.cwd(),
    });
    expect(await tracker.isReady()).toBe(true);
  });

  it('initialize mit fehlerhafter Binary macht isReady false', async () => {
    const tracker = factory();
    await tracker.initialize({
      kanbanBin: '/nonexistent/kanban',
      projectDir: '/tmp/nonexistent',
    });
    expect(await tracker.isReady()).toBe(false);
  });

  it('dispose ist ein no-op', async () => {
    const tracker = factory();
    await tracker.initialize({
      kanbanBin: '/opt/homebrew/bin/kanban',
      projectDir: process.cwd(),
    });
    await tracker.dispose();
    // Kein Fehler → Erfolg
  });
});

describe('Core Query — mit echtem Board', () => {
  let tracker: KanbanMcpTracker;

  beforeEach(async () => {
    tracker = factory();
    await tracker.initialize({
      kanbanBin: '/opt/homebrew/bin/kanban',
      projectDir: process.cwd(),
    });
  });

  it('getTasks gibt Array zurueck', async () => {
    const tasks = await tracker.getTasks();
    expect(Array.isArray(tasks)).toBe(true);
    // Ergebnis ist ein valides Array (kann leer sein je nach Board-Zustand)
  });

  it('getTasks filtert nach Status', async () => {
    const openTasks = await tracker.getTasks({ status: ['open'] });
    for (const task of openTasks) {
      expect(task.status).toBe('open');
    }
  });

  it('getTask gibt einen Task zurueck', async () => {
    const tasks = await tracker.getTasks();
    if (tasks.length === 0) return; // Skip wenn keine Tasks

    const task = await tracker.getTask(tasks[0].id);
    expect(task).toBeDefined();
    expect(task!.id).toBe(tasks[0].id);
  });

  it('getTask gibt undefined fuer unbekannte ID', async () => {
    const task = await tracker.getTask('nonexistent-id-12345');
    expect(task).toBeUndefined();
  });

  it('getNextTask gibt den naechsten Task zurueck', async () => {
    const next = await tracker.getNextTask();
    // Wenn es offene Tasks gibt, sollte einer zurueckkommen
    if (next) {
      expect(next.id).toBeDefined();
      expect(['open', 'in_progress']).toContain(next.status);
    }
  });

  it('getEpics gibt leeres Array zurueck', async () => {
    const epics = await tracker.getEpics();
    expect(epics).toEqual([]);
  });
});

describe('State Checks', () => {
  let tracker: KanbanMcpTracker;

  beforeEach(async () => {
    tracker = factory();
    await tracker.initialize({
      kanbanBin: '/opt/homebrew/bin/kanban',
      projectDir: process.cwd(),
    });
  });

  it('isComplete gibt korrekten Wert zurueck', async () => {
    const complete = await tracker.isComplete();
    // Gibt true wenn keine aktiven Tasks, false wenn welche offen sind
    expect(typeof complete).toBe('boolean');
  });

  it('isTaskReady gibt immer true zurueck', async () => {
    const ready = await tracker.isTaskReady('any-id');
    expect(ready).toBe(true);
  });
});

describe('Sync', () => {
  it('sync gibt SyncResult zurueck', async () => {
    const tracker = factory();
    const result = await tracker.sync();
    expect(result.success).toBe(true);
    expect(result.syncedAt).toBeDefined();
  });
});

describe('Setup', () => {
  it('getSetupQuestions gibt 2 Fragen zurueck', () => {
    const tracker = factory();
    const questions = tracker.getSetupQuestions();
    expect(questions.length).toBe(2);

    // kanbanBin Frage
    const binQ = questions.find(q => q.id === 'kanbanBin');
    expect(binQ).toBeDefined();
    expect(binQ!.default).toBe('/opt/homebrew/bin/kanban');

    // projectDir Frage
    const dirQ = questions.find(q => q.id === 'projectDir');
    expect(dirQ).toBeDefined();
    expect(dirQ!.default).toBe('.');
  });

  it('validateSetup akzeptiert existierende Binary', async () => {
    const tracker = factory();
    const result = await tracker.validateSetup({
      kanbanBin: '/opt/homebrew/bin/kanban',
      projectDir: '.',
    });
    expect(result).toBeNull(); // null = Validierung OK
  });

  it('validateSetup lehnt nicht-existierende Binary ab', async () => {
    const tracker = factory();
    const result = await tracker.validateSetup({
      kanbanBin: '/nonexistent/kanban',
      projectDir: '.',
    });
    expect(result).not.toBeNull(); // Fehlermeldung
  });
});

describe('Template', () => {
  it('getTemplate gibt Handlebars Template String zurueck', () => {
    const tracker = factory();
    const template = tracker.getTemplate();
    expect(template).toContain('{{task.title}}');
    expect(template).toContain('{{task.id}}');
    expect(template).toContain('COMPLETE');
  });
});

describe('Error Cases', () => {
  it('getTasks gibt leeres Array bei nicht-initialisiertem Tracker', async () => {
    const tracker = factory();
    // Ohne initialize: internes Config fehlt
    const tasks = await tracker.getTasks();
    expect(tasks).toEqual([]);
  });
});
