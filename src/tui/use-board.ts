// Custom Hook: Board-Daten laden und Task-Aktionen ausfuehren
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { watch, type FSWatcher } from "node:fs";
import type { Column, ListTasksFilter, Task, UpdateTaskInput } from "../core/types.ts";
import { openDb, getBoardPaths, loadBoardConfig } from "../core/db.ts";
import { BoardService } from "../core/board-service.ts";
import { TaskService } from "../core/task-service.ts";
import { NotesService } from "../core/notes-service.ts";
import { ORPHAN_COLUMN_ID } from "./theme.ts";

// Ergebnis einer Aktion, die von der Zustandsmaschine abgelehnt werden kann
// (moveTask, completeTask). Statt zu werfen wird die Ablehnung bis in die
// Komponente durchgereicht (P1-5) -- app.tsx entscheidet, ob ein
// Override-Dialog gezeigt wird. 'reason' ist der VOLLE, handlungsleitende
// Ablehnungstext aus TransitionService (ADR 0002) -- nie gekuerzt.
export interface ActionResult {
  ok: boolean;
  reason?: string;
}

// Ergebnis von addTask: 'redirectedTo' ist nur gesetzt, wenn die urspruenglich
// gewuenschte Spalte keine Eintrittsspalte war und still nach 'todo'
// umgeleitet wurde (P1-5 Teil 2 -- Fehlbedienung, kein Override-Fall).
export interface AddTaskResult {
  redirectedTo?: string;
}

// Ob 'task' aktuell in einer Spalte sitzt, die es in 'columns' (echte Spalten
// aus config.json) nicht gibt -- P1-6/ADR 0001. Wird sowohl fuer die virtuelle
// Sammelspalte (board-view.tsx) als auch fuer die reason "orphan-recovery"
// beim Herausbewegen (app.tsx) verwendet, damit die Pruefung nur an einer
// Stelle lebt.
export function isOrphanTask(task: Task, columns: Column[]): boolean {
  return !columns.some((c) => c.id === task.columnId);
}

// Virtuelle Sammelspalte fuer Waisen -- taucht NIE in 'columns' auf (das wuerde
// echte Kettenlogik verfaelschen, die 'columns' als Wahrheit behandelt),
// sondern nur in der abgeleiteten 'displayColumns'-Liste fuer Rendering und
// Cursor-Navigation (Plan Abschnitt 3.8, Kanban-Task P1-6). 'position' ist
// hier rein informativ -- keine Kettenregel liest sie.
function buildOrphanColumn(position: number): Column {
  return {
    id: ORPHAN_COLUMN_ID,
    name: "⚠ Ohne Spalte",
    position,
    wipLimit: 0,
    allowEntry: false,
    isTerminal: false,
  };
}

// Services erstellen (oeffnet DB). Liest config.json genau einmal -- der
// Aufrufer (loadData) darf sie NICHT ein zweites Mal laden (siehe Kanban-Task
// 7Lnjgzi08s7p / GitHub #35).
function createServices(workingDir: string) {
  const paths = getBoardPaths(workingDir);
  const db = openDb(paths.dbPath);
  const config = loadBoardConfig(paths.configPath);
  const boardService = new BoardService(db, config);
  const notesService = new NotesService(paths.kanbanDir);
  const taskService = new TaskService(db, boardService, notesService);
  return { db, boardService, taskService, notesService, kanbanDir: paths.kanbanDir };
}

// Daten aus der DB laden. Exportiert (statt modul-privat), damit der Zaehler
// aus #35 ("loadBoardConfig wird pro loadData()-Aufruf genau einmal
// aufgerufen") direkt getestet werden kann, ohne den Hook ueber einen
// React-Renderer laufen zu lassen -- im Repo gibt es dafuer kein
// Test-Werkzeug (kein ink-testing-library, keine neue Dependency ohne
// Ruecksprache).
//
// P2-3: 'options.sort' reicht optional an TaskService.listTasks() durch (die
// Sortier-Logik selbst lebt dort, buildOrderBy() -- die TUI sortiert nicht
// nach). Ohne 'options' identisch zum bisherigen Aufruf ohne Filter, also
// rueckwaertskompatibel zu allen bestehenden Aufrufern.
export function loadData(workingDir: string, options?: { sort?: ListTasksFilter["sort"] }) {
  const { db, boardService, taskService } = createServices(workingDir);
  const columns = boardService.getColumns();
  const orphanColumnIds = boardService.getOrphanColumnIds();
  const tasks = taskService.listTasks({ sort: options?.sort });
  db.close();
  return { columns, tasks, orphanColumnIds };
}

// P2-3, Anschlussfrage 2 (K-2): die Prioritaets-Sortierung ist ein reiner
// Ansichtsmodus und MUSS im Verschiebe-Modus abgeschaltet sein -- sonst
// springt die Karte unter dem Cursor weg, waehrend man sie mit Pfeiltasten
// bewegt (reorderTask aendert 'position', die Anzeige wuerde aber weiter nach
// Prioritaet neu ordnen). Als reine, exportierte Funktion, damit diese harte
// Bedingung automatisiert nachweisbar ist statt nur manuell in der TUI
// geprueft zu werden. Prueft NUR 'moving', nicht zusaetzlich den
// ausgewaehlten Task -- greift also auch dann, wenn waehrend des Verschiebens
// von aussen (z.B. MCP) Tasks geaendert werden.
export function resolveEffectiveSort(sortByPriority: boolean, moving: boolean): ListTasksFilter["sort"] {
  return sortByPriority && !moving ? "priority" : undefined;
}

// Task-Aktion ausfuehren (oeffnet und schliesst DB selbst). Generisch ueber
// den Rueckgabewert der Aktion, damit moveTask/completeTask/addTask ein
// Ergebnisobjekt statt eines geworfenen Fehlers durchreichen koennen (P1-5).
function withServices<T>(workingDir: string, action: (ts: TaskService) => T): T {
  const { db, taskService } = createServices(workingDir);
  const result = action(taskService);
  db.close();
  return result;
}

// 'sort' (P2-3): optionaler Ansichtsmodus, vom Aufrufer (app.tsx) ueber
// resolveEffectiveSort() berechnet -- dieser Hook entscheidet nicht selbst,
// ob sortiert werden darf (kennt 'moving' nicht), reicht den Wert nur durch.
export function useBoard(workingDir: string, sort?: ListTasksFilter["sort"]) {
  const [columns, setColumns] = useState<Column[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [orphanColumnIds, setOrphanColumnIds] = useState<string[]>([]);

  // kanbanDir fuer Editor-Zugriff
  const kanbanDir = getBoardPaths(workingDir).kanbanDir;

  // 'sort' in den Dependencies: aendert sich der Ansichtsmodus, bekommt
  // 'refresh' eine neue Identitaet -- der bestehende Effekt in app.tsx
  // (`useEffect(() => { board.refresh(); }, [board.refresh])`) greift dann
  // automatisch erneut, ohne dass app.tsx selbst auf 'sort' reagieren muesste.
  const refresh = useCallback(() => {
    const data = loadData(workingDir, { sort });
    setColumns(data.columns);
    setTasks(data.tasks);
    setOrphanColumnIds(data.orphanColumnIds);
  }, [workingDir, sort]);

  // Anzeige-Spalten: echte Spalten + virtuelle Sammelspalte, aber NUR wenn es
  // tatsaechlich Waisen gibt (Plan Abschnitt 3.8). 'columns' bleibt dabei
  // unangetastet -- Kettenlogik (canEnter/canMove-Aufrufer in app.tsx) muss
  // sich immer auf die echte Liste verlassen koennen.
  const displayColumns = useMemo(
    () => (orphanColumnIds.length > 0 ? [...columns, buildOrphanColumn(columns.length)] : columns),
    [columns, orphanColumnIds],
  );

  // Auto-Refresh: DB-Datei ueberwachen fuer externe Aenderungen (z.B. MCP)
  const selfWrite = useRef(false);
  useEffect(() => {
    const paths = getBoardPaths(workingDir);
    let watcher: FSWatcher;
    try {
      watcher = watch(paths.dbPath, () => {
        // Eigene Schreibvorgaenge ignorieren
        if (selfWrite.current) { selfWrite.current = false; return; }
        refresh();
      });
    } catch { return; }
    return () => { watcher.close(); };
  }, [workingDir, refresh]);

  // Eigene DB-Schreibvorgaenge: selfWrite-Flag setzen damit Watcher nicht doppelt refresht
  const writeAndRefresh = useCallback(<T,>(action: (ts: TaskService) => T): T => {
    selfWrite.current = true;
    const result = withServices(workingDir, action);
    refresh();
    return result;
  }, [workingDir, refresh]);

  // P1-5: wirft nicht mehr, sondern reicht die Ablehnung als ActionResult
  // durch -- app.tsx entscheidet, ob dafuer ein Override-Dialog erscheint.
  // 'opts.reason' transportiert u.a. "orphan-recovery" (P1-6), wenn die
  // Quellspalte eine Waise ist -- das entscheidet der Aufrufer, nicht dieser
  // Hook (der kennt nur 'columns', nicht den konkreten Task-Kontext der UI).
  const moveTask = useCallback((taskId: string, columnId: string, opts?: { override?: boolean; reason?: string }): ActionResult => {
    return writeAndRefresh((ts) => {
      try {
        ts.moveTask(taskId, columnId, { override: opts?.override, reason: opts?.reason });
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
    });
  }, [writeAndRefresh]);

  // P1-5: Override-Pfad nutzt bewusst dasselbe moveTask({override:true}) in
  // die Terminal-Spalte -- TaskService.completeTask() selbst kennt kein
  // 'override' (Core unveraendert), und es soll auch keinen zweiten
  // Umgehungsweg geben (siehe ADR 0002 / Bericht an team-lead).
  const completeTask = useCallback((taskId: string, opts?: { override?: boolean }): ActionResult => {
    return writeAndRefresh((ts) => {
      try {
        if (opts?.override) {
          const terminal = columns.find((c) => c.isTerminal);
          if (!terminal) throw new Error("Keine Terminal-Spalte konfiguriert");
          ts.moveTask(taskId, terminal.id, { override: true });
        } else {
          ts.completeTask(taskId);
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
    });
  }, [writeAndRefresh, columns]);

  // P1-5 Teil 2: addTask wirft ausschliesslich, wenn die Zielspalte keine
  // Eintrittsspalte ist (canEnter, siehe transition-service.ts). Das ist eine
  // Fehlbedienung, kein Override-Fall -- still nach 'todo' umleiten statt den
  // Fehler zu zeigen (Plan Abschnitt 3.4).
  const addTask = useCallback((title: string, columnId?: string): AddTaskResult => {
    return writeAndRefresh((ts) => {
      try {
        ts.addTask({ title, columnId });
        return {};
      } catch {
        ts.addTask({ title, columnId: "todo" });
        return { redirectedTo: "todo" };
      }
    });
  }, [writeAndRefresh]);

  const deleteTask = useCallback((taskId: string) => {
    writeAndRefresh((ts) => ts.deleteTask(taskId));
  }, [writeAndRefresh]);

  const updateTask = useCallback((taskId: string, changes: UpdateTaskInput) => {
    writeAndRefresh((ts) => ts.updateTask(taskId, changes));
  }, [writeAndRefresh]);

  const reorderTask = useCallback((taskId: string, direction: "up" | "down") => {
    writeAndRefresh((ts) => ts.reorderTask(taskId, direction));
  }, [writeAndRefresh]);

  const listArchived = useCallback((): Task[] => {
    const { db, taskService } = createServices(workingDir);
    const { tasks } = taskService.purgeArchive({ dryRun: true });
    db.close();
    return tasks;
  }, [workingDir]);

  const archiveTask = useCallback((taskId: string) => {
    writeAndRefresh((ts) => ts.archiveTask(taskId));
  }, [writeAndRefresh]);

  const restoreTask = useCallback((taskId: string) => {
    writeAndRefresh((ts) => ts.restoreTask(taskId));
  }, [writeAndRefresh]);

  // Einzelnen Task laden (mit Notes)
  const getTask = useCallback((taskId: string): Task | null => {
    const { db, taskService } = createServices(workingDir);
    const task = taskService.getTask(taskId);
    db.close();
    return task;
  }, [workingDir]);

  // Abhaengigkeiten
  const getDependencies = useCallback((taskId: string): import("../core/types.ts").Task[] => {
    const { db, taskService } = createServices(workingDir);
    const deps = taskService.getDependencies(taskId);
    db.close();
    return deps;
  }, [workingDir]);

  const getDependents = useCallback((taskId: string): import("../core/types.ts").Task[] => {
    const { db, taskService } = createServices(workingDir);
    const deps = taskService.getDependents(taskId);
    db.close();
    return deps;
  }, [workingDir]);

  const addDependency = useCallback((taskId: string, dependsOnId: string) => {
    writeAndRefresh((ts) => ts.addDependency(taskId, dependsOnId));
  }, [writeAndRefresh]);

  const removeDependency = useCallback((taskId: string, dependsOnId: string) => {
    writeAndRefresh((ts) => ts.removeDependency(taskId, dependsOnId));
  }, [writeAndRefresh]);

  const purgeArchive = useCallback(() => {
    const { db, taskService } = createServices(workingDir);
    const result = taskService.purgeArchive();
    db.close();
    return result;
  }, [workingDir]);

  return {
    columns, displayColumns, tasks, orphanColumnIds, kanbanDir, refresh,
    moveTask, completeTask, addTask, deleteTask, updateTask, reorderTask,
    archiveTask, listArchived, restoreTask, getTask, getDependencies,
    getDependents, addDependency, removeDependency, purgeArchive,
  };
}
