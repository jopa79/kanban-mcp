// Custom Hook: Board-Daten laden und Task-Aktionen ausfuehren
import { useState, useCallback } from "react";
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

  const moveTask = useCallback((taskId: string, columnId: string) => {
    withServices(workingDir, (ts) => ts.moveTask(taskId, columnId));
    refresh();
  }, [workingDir, refresh]);

  const completeTask = useCallback((taskId: string) => {
    withServices(workingDir, (ts) => ts.completeTask(taskId));
    refresh();
  }, [workingDir, refresh]);

  const addTask = useCallback((title: string, columnId?: string) => {
    withServices(workingDir, (ts) => ts.addTask({ title, columnId }));
    refresh();
  }, [workingDir, refresh]);

  const deleteTask = useCallback((taskId: string) => {
    withServices(workingDir, (ts) => ts.deleteTask(taskId));
    refresh();
  }, [workingDir, refresh]);

  const updateTask = useCallback((taskId: string, changes: UpdateTaskInput) => {
    withServices(workingDir, (ts) => ts.updateTask(taskId, changes));
    refresh();
  }, [workingDir, refresh]);

  const reorderTask = useCallback((taskId: string, direction: "up" | "down") => {
    withServices(workingDir, (ts) => ts.reorderTask(taskId, direction));
    refresh();
  }, [workingDir, refresh]);

  const listArchived = useCallback((): Task[] => {
    const { db, taskService } = createServices(workingDir);
    const { tasks } = taskService.purgeArchive({ dryRun: true });
    db.close();
    return tasks;
  }, [workingDir]);

  const archiveTask = useCallback((taskId: string) => {
    withServices(workingDir, (ts) => ts.archiveTask(taskId));
    refresh();
  }, [workingDir, refresh]);

  const restoreTask = useCallback((taskId: string) => {
    withServices(workingDir, (ts) => ts.restoreTask(taskId));
    refresh();
  }, [workingDir, refresh]);

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
    withServices(workingDir, (ts) => ts.addDependency(taskId, dependsOnId));
    refresh();
  }, [workingDir, refresh]);

  const removeDependency = useCallback((taskId: string, dependsOnId: string) => {
    withServices(workingDir, (ts) => ts.removeDependency(taskId, dependsOnId));
    refresh();
  }, [workingDir, refresh]);

  const purgeArchive = useCallback(() => {
    const { db, taskService } = createServices(workingDir);
    const result = taskService.purgeArchive();
    db.close();
    return result;
  }, [workingDir]);

  return { columns, tasks, kanbanDir, refresh, moveTask, completeTask, addTask, deleteTask, updateTask, reorderTask, archiveTask, listArchived, restoreTask, getTask, getDependencies, getDependents, addDependency, removeDependency, purgeArchive };
}
