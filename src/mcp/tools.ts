// MCP Tool-Definitionen und Handler
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { initBoard } from "../core/db.ts";
import { withContext } from "./mcp-context.ts";
import { registerArchiveTools } from "./tools-archive.ts";
import { registerExtraTools } from "./tools-extras.ts";
import { registerExportTools } from "./tools-export.ts";

// Alle Tools beim Server registrieren
export function registerTools(server: McpServer, workingDir: string): void {
  // --- kanban_init ---
  server.registerTool(
    "kanban_init",
    {
      title: "Board initialisieren",
      description: "Neues Kanban Board im aktuellen Verzeichnis erstellen",
      inputSchema: z.object({
        name: z.string().optional().describe("Board-Name (default: 'Kanban Board')"),
        path: z.string().optional().describe("Verzeichnis (default: cwd)"),
      }),
    },
    async ({ name, path }) => {
      try {
        const dir = path ?? workingDir;
        const boardName = name ?? "Kanban Board";
        const kanbanDir = initBoard(dir, boardName);
        return { content: [{ type: "text", text: `Board '${boardName}' erstellt in ${kanbanDir}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Fehler: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // --- kanban_add_task ---
  server.registerTool(
    "kanban_add_task",
    {
      title: "Task hinzufuegen",
      description: "Neuen Task zum Kanban Board hinzufuegen",
      inputSchema: z.object({
        title: z.string().describe("Task-Titel (1-200 Zeichen)"),
        description: z.string().optional().describe("Task-Beschreibung"),
        columnId: z.string().optional().describe("Spalte (default: todo)"),
        createdBy: z.string().optional().describe("Ersteller (z.B. claude, user)"),
        assignedTo: z.string().optional().describe("Zugewiesen an"),
        labels: z.array(z.string()).optional().describe("Labels"),
        dependsOn: z.array(z.string()).optional().describe("Abhaengigkeiten (Task-IDs)"),
        notes: z.string().optional().describe("Markdown-Notizen zum Task"),
      }),
    },
    async ({ title, description, columnId, createdBy, assignedTo, labels, dependsOn, notes }) => {
      try {
        return withContext(workingDir, ({ taskService }) => {
          const task = taskService.addTask({
            title, description, columnId, createdBy, assignedTo, labels, dependsOn, notes,
          });
          return { content: [{ type: "text", text: `Task erstellt: "${task.title}" (ID: ${task.id}) → ${task.columnId}` }] };
        });
      } catch (err) {
        return { content: [{ type: "text", text: `Fehler: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // --- kanban_get_task ---
  server.registerTool(
    "kanban_get_task",
    {
      title: "Task abrufen",
      description: "Einzelnen Task per ID abrufen",
      inputSchema: z.object({
        id: z.string().describe("Task-ID (kann gekuerzt sein)"),
      }),
    },
    async ({ id }) => {
      try {
        return withContext(workingDir, ({ taskService }) => {
          const task = taskService.getTask(id);
          if (!task) {
            return { content: [{ type: "text", text: `Task '${id}' nicht gefunden` }], isError: true };
          }
          return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
        });
      } catch (err) {
        return { content: [{ type: "text", text: `Fehler: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // --- kanban_list_tasks ---
  server.registerTool(
    "kanban_list_tasks",
    {
      title: "Tasks auflisten",
      description: "Alle Tasks auflisten, optional nach Spalte oder Assignee filtern",
      inputSchema: z.object({
        columnId: z.string().optional().describe("Nach Spalte filtern"),
        createdBy: z.string().optional().describe("Nach Ersteller filtern"),
        assignedTo: z.string().optional().describe("Nach Assignee filtern"),
      }),
    },
    async ({ columnId, createdBy, assignedTo }) => {
      try {
        return withContext(workingDir, ({ taskService }) => {
          const tasks = taskService.listTasks({ columnId, createdBy, assignedTo });
          return { content: [{ type: "text", text: JSON.stringify(tasks, null, 2) }] };
        });
      } catch (err) {
        return { content: [{ type: "text", text: `Fehler: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // --- kanban_move_task ---
  server.registerTool(
    "kanban_move_task",
    {
      title: "Task verschieben",
      description: "Task in eine andere Spalte verschieben",
      inputSchema: z.object({
        id: z.string().describe("Task-ID"),
        columnId: z.string().describe("Ziel-Spalte (z.B. todo, in-progress, review, done)"),
      }),
    },
    async ({ id, columnId }) => {
      try {
        return withContext(workingDir, ({ taskService }) => {
          const task = taskService.moveTask(id, columnId);
          return { content: [{ type: "text", text: `Task verschoben: "${task.title}" (ID: ${task.id}) → ${task.columnId}` }] };
        });
      } catch (err) {
        return { content: [{ type: "text", text: `Fehler: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // --- kanban_update_task ---
  server.registerTool(
    "kanban_update_task",
    {
      title: "Task aktualisieren",
      description: "Task-Eigenschaften aendern (Titel, Beschreibung, Assignee, Labels)",
      inputSchema: z.object({
        id: z.string().describe("Task-ID"),
        title: z.string().optional().describe("Neuer Titel"),
        description: z.string().nullable().optional().describe("Neue Beschreibung"),
        assignedTo: z.string().nullable().optional().describe("Neuer Assignee"),
        labels: z.array(z.string()).optional().describe("Neue Labels"),
        notes: z.string().nullable().optional().describe("Neue Markdown-Notizen (null zum Loeschen)"),
      }),
    },
    async ({ id, title, description, assignedTo, labels, notes }) => {
      try {
        return withContext(workingDir, ({ taskService }) => {
          const task = taskService.updateTask(id, { title, description, assignedTo, labels, notes });
          return { content: [{ type: "text", text: `Task aktualisiert: "${task.title}" (ID: ${task.id})` }] };
        });
      } catch (err) {
        return { content: [{ type: "text", text: `Fehler: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // --- kanban_delete_task ---
  server.registerTool(
    "kanban_delete_task",
    {
      title: "Task loeschen",
      description: "Task permanent loeschen",
      inputSchema: z.object({
        id: z.string().describe("Task-ID"),
      }),
    },
    async ({ id }) => {
      try {
        return withContext(workingDir, ({ taskService }) => {
          const task = taskService.getTask(id);
          taskService.deleteTask(id);
          return { content: [{ type: "text", text: `Task '${task?.title}' geloescht` }] };
        });
      } catch (err) {
        return { content: [{ type: "text", text: `Fehler: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // Weitere Tools aus separaten Dateien registrieren
  registerArchiveTools(server, workingDir);
  registerExtraTools(server, workingDir);
  registerExportTools(server, workingDir);
}
