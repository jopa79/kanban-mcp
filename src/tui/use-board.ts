// Custom Hook: Board-Daten laden und Task-Aktionen ausfuehren
import { useState, useCallback, useEffect, useRef } from "react";
import { watch, type FSWatcher } from "node:fs";
import type { Column, Task, UpdateTaskInput } from "../core/types.ts";
import { openDb, getBoardPaths } from "../core/db.ts";
import { BoardService } from "../core/board-service.ts";
import { TaskService } from "../core/task-service.ts";
import { NotesService } from "../core/notes-service.ts";

// Services erstellen (oeffnet DB)
function createServices(workingDir: string) {
  const paths = getBoardPaths(workingDir);
  const db = openDb(paths.dbPath);
  const boardService = new BoardService(db);
  const notesService = new NotesService(paths.kanbanDir);
  const taskService = new TaskService(db, boardService, notesService);
  return { db, taskService, notesService, kanbanDir: paths.kanbanDir };
}

// Daten aus der DB laden
function loadData(workingDir: string) {
  const { db, taskService } = createServices(workingDir);
  const boardService = new BoardService(db);
  const columns = boardService.getColumns();
  const tasks = taskService.listTasks();
  db.close();
  return { columns, tasks };
}

// Task-Aktion ausfuehren (oeffnet und schliesst DB selbst)
function withServices(workingDir: string, action: (ts: TaskService) => void) {
  const { db, taskService } = createServices(workingDir);
  action(taskService);
  db.close();
}

export function useBoard(workingDir: string) {
  const [columns, setColumns] = useState<Column[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  // kanbanDir fuer Editor-Zugriff
  const kanbanDir = getBoardPaths(workingDir).kanbanDir;

  const refresh = useCallback(() => {
    const data = loadData(workingDir);
    setColumns(data.columns);
    setTasks(data.tasks);
  }, [workingDir]);

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
  const writeAndRefresh = useCallback((action: (ts: TaskService) => void) => {
    selfWrite.current = true;
    withServices(workingDir, action);
    refresh();
  }, [workingDir, refresh]);

  const moveTask = useCallback((taskId: string, columnId: string) => {
    writeAndRefresh((ts) => ts.moveTask(taskId, columnId));
  }, [writeAndRefresh]);

  const completeTask = useCallback((taskId: string) => {
    writeAndRefresh((ts) => ts.completeTask(taskId));
  }, [writeAndRefresh]);

  const addTask = useCallback((title: string, columnId?: string) => {
    writeAndRefresh((ts) => ts.addTask({ title, columnId }));
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

  return { columns, tasks, kanbanDir, refresh, moveTask, completeTask, addTask, deleteTask, updateTask, reorderTask, archiveTask, listArchived, restoreTask, getTask, getDependencies, getDependents, addDependency, removeDependency, purgeArchive };
}
