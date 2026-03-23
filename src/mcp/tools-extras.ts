// MCP Tools: Duplikat-Erkennung, Abschluss, Status
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { withContext } from "./mcp-context.ts";

export function registerExtraTools(server: McpServer, workingDir: string): void {
  // --- kanban_add_task_checked ---
  server.registerTool(
    "kanban_add_task_checked",
    {
      title: "Task mit Duplikat-Pruefung erstellen",
      description: "Task erstellen, aber ablehnen wenn ein aehnlicher Task bereits existiert. Verwende force=true um trotzdem zu erstellen.",
      inputSchema: z.object({
        title: z.string().describe("Task-Titel"),
        description: z.string().optional().describe("Task-Beschreibung"),
        columnId: z.string().optional().describe("Spalte (default: todo)"),
        createdBy: z.string().optional().describe("Ersteller"),
        assignedTo: z.string().optional().describe("Zugewiesen an"),
        labels: z.array(z.string()).optional().describe("Labels"),
        notes: z.string().optional().describe("Markdown-Notizen zum Task"),
        force: z.boolean().optional().describe("Erstellen auch wenn aehnlich"),
      }),
    },
    async ({ title, description, columnId, createdBy, assignedTo, labels, notes, force }) => {
      try {
        return withContext(workingDir, ({ taskService }) => {
          const result = taskService.addTaskChecked(
            { title, description, columnId, createdBy, assignedTo, labels, notes },
            { force },
          );
          if (result.rejected) {
            const similar = result.similarTasks?.map((t: { title: string }) => `"${t.title}"`).join(", ") ?? "";
            return { content: [{ type: "text", text: `Abgelehnt: aehnlicher Task existiert — ${similar}. Verwende force=true zum Erstellen.` }] };
          }
          return { content: [{ type: "text", text: `Task erstellt: "${result.task.title}" (ID: ${result.task.id}) → ${result.task.columnId}` }] };
        });
      } catch (err) {
        return { content: [{ type: "text", text: `Fehler: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // --- kanban_complete_task ---
  server.registerTool(
    "kanban_complete_task",
    {
      title: "Task abschliessen",
      description: "Task als erledigt markieren (in Done-Spalte verschieben)",
      inputSchema: z.object({
        id: z.string().describe("Task-ID"),
      }),
    },
    async ({ id }) => {
      try {
        return withContext(workingDir, ({ taskService }) => {
          const task = taskService.completeTask(id);
          return { content: [{ type: "text", text: `Task abgeschlossen: "${task.title}" (ID: ${task.id}) → ${task.columnId}` }] };
        });
      } catch (err) {
        return { content: [{ type: "text", text: `Fehler: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // --- kanban_status ---
  server.registerTool(
    "kanban_status",
    {
      title: "Board-Status",
      description: "Uebersicht ueber alle Spalten und Task-Anzahlen",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return withContext(workingDir, ({ taskService, config }) => {
          const status = taskService.getStatus();
          const result = { board: config.name, ...status };
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        });
      } catch (err) {
        return { content: [{ type: "text", text: `Fehler: ${(err as Error).message}` }], isError: true };
      }
    },
  );
}
