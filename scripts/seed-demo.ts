// Demo-Daten fuer TUI-Screenshot erzeugen
// Nutzung: bun run scripts/seed-demo.ts
// Raeumen: rm -rf .kanban/

import { join } from "node:path";
import { rmSync, existsSync } from "node:fs";
import { initBoard } from "../src/core/db";
import { BoardService } from "../src/core/board-service";
import { TaskService } from "../src/core/task-service";
import { NotesService } from "../src/core/notes-service";
import { openDb } from "../src/core/db";

const PROJECT_DIR = join(import.meta.dir, "..");
const kanbanPath = join(PROJECT_DIR, ".kanban");

// Bestehendes Board entfernen falls vorhanden
if (existsSync(kanbanPath)) {
  rmSync(kanbanPath, { recursive: true });
  console.log("Bestehendes .kanban/ entfernt.");
}

// Board initialisieren
console.log("Board initialisieren...");
initBoard(PROJECT_DIR, "kanban-mcp Demo");

// DB oeffnen und Services erstellen
const dbPath = join(PROJECT_DIR, ".kanban", "board.db");
const kanbanDir = join(PROJECT_DIR, ".kanban");
const db = openDb(dbPath);
const boardService = new BoardService(db);
const notesService = new NotesService(kanbanDir);
const taskService = new TaskService(db, boardService, notesService);

// --- Backlog Tasks ---
taskService.addTask({
  title: "API Dokumentation schreiben",
  description: "OpenAPI Spec fuer alle MCP Endpoints",
  columnId: "backlog",
  labels: ["docs"],
  createdBy: "claude",
});

taskService.addTask({
  title: "Error Handling refactoren",
  description: "Einheitliche Fehlerklassen einfuehren",
  columnId: "backlog",
  labels: ["refactor", "chore"],
  createdBy: "claude",
});

// --- Todo Tasks ---
taskService.addTask({
  title: "OAuth2 Login implementieren",
  description: "Google + GitHub Provider",
  columnId: "todo",
  labels: ["feature"],
  assignedTo: "jopa",
  createdBy: "claude",
});

const bugTask = taskService.addTask({
  title: "Bug #42: Spalten-Overflow",
  description: "WIP-Limit wird bei Drag ignoriert",
  columnId: "todo",
  labels: ["bug"],
  createdBy: "jopa",
});

taskService.addTask({
  title: "Unit Tests erweitern",
  description: "Coverage auf 80% bringen",
  columnId: "todo",
  labels: ["test"],
  createdBy: "claude",
});

// --- In Progress Tasks ---
const exportTask = taskService.addTask({
  title: "MCP Export/Import",
  description: "Board als ZIP exportieren und aus ZIP wiederherstellen",
  columnId: "in-progress",
  labels: ["feature"],
  assignedTo: "jopa",
  createdBy: "claude",
  notes: "## Status\n- [x] Export Service\n- [x] Import Service\n- [ ] MCP Tools registrieren\n- [ ] CLI Commands\n\n## Architektur\nExport erzeugt ein ZIP mit board.db + notes/.\nImport erkennt ob bereits ein Board existiert\nund fragt ggf. nach Ueberschreiben.\n\n## Offene Fragen\n- Sollen Labels beim Import gemergt werden?\n- Max. ZIP-Groesse begrenzen?",
});

taskService.addTask({
  title: "CLI Hilfe-Texte",
  description: "Alle Commands dokumentieren",
  columnId: "in-progress",
  labels: ["enhancement"],
  createdBy: "claude",
});

// --- Review Tasks ---
taskService.addTask({
  title: "TUI Filter-Funktion",
  description: "Tasks nach Titel durchsuchen",
  columnId: "review",
  labels: ["feature"],
  assignedTo: "jopa",
  createdBy: "claude",
});

// --- Done Tasks ---
taskService.addTask({
  title: "SQLite Setup + Migrationen",
  columnId: "done",
  labels: ["feature"],
  createdBy: "claude",
});

taskService.addTask({
  title: "Board Initialisierung",
  columnId: "done",
  labels: ["feature"],
  createdBy: "claude",
});

// Dependency: Bug-Task wird durch Export-Task blockiert (fuer [B] Anzeige)
taskService.addDependency(bugTask.id, exportTask.id);

db.close();
console.log("Demo-Daten erstellt! Starte TUI mit: bun run src/index.ts tui");
