// MCP Tools: Duplikat-Erkennung, Abschluss, Status
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { withContext } from "./mcp-context.ts";
import { reportedBySchema } from "./schemas.ts";

export function registerExtraTools(server: McpServer, workingDir: string): void {
  // --- kanban_add_task_checked ---
  server.registerTool(
    "kanban_add_task_checked",
    {
      title: "Task mit Duplikat-Pruefung erstellen",
      // P1-4 (ADR 0002): kein Hinweis auf force hier -- die Beschreibung ist
      // KEINE Einladung zum Eskalieren. force bleibt im Schema (Duplikat-
      // Erkennung ist eine fehlbare Heuristik, similarity.ts), aber wer ihn
      // braucht, kennt ihn bereits -- er wird nicht beworben.
      description: "Task erstellen, aber ablehnen wenn ein aehnlicher Task bereits existiert.",
      inputSchema: z.object({
        title: z.string().describe("Task-Titel"),
        description: z.string().optional().describe("Task-Beschreibung"),
        columnId: z.string().optional().describe("Spalte (default: todo)"),
        createdBy: z.string().optional().describe("Ersteller"),
        assignedTo: z.string().optional().describe("Zugewiesen an"),
        labels: z.array(z.string()).optional().describe("Labels"),
        notes: z.string().optional().describe("Markdown-Notizen zum Task"),
        reportedBy: reportedBySchema,
        priority: z.string().optional().describe("Prioritaet: high, medium oder low"),
        dueDate: z.string().optional().describe("Faelligkeit als YYYY-MM-DD"),
        force: z.boolean().optional(),
      }),
    },
    async ({ title, description, columnId, createdBy, assignedTo, labels, notes, reportedBy, priority, dueDate, force }) => {
      try {
        return withContext(workingDir, ({ taskService }) => {
          const result = taskService.addTaskChecked(
            { title, description, columnId, createdBy, assignedTo, labels, notes, reportedBy, priority, dueDate },
            { force },
          );
          if (result.rejected || !result.task) {
            // P1-4: Titel UND IDs nennen -- ohne IDs kann der Agent den
            // bestehenden Task nicht oeffnen und muss raten. Kein force-Hinweis.
            const lines = (result.similarTasks ?? []).map(
              (t) => `  [${t.id.slice(0, 8)}] "${t.title}" (${t.columnId})`,
            );
            return {
              content: [{
                type: "text",
                text: `Abgelehnt: aehnliche Tasks existieren bereits.\n${lines.join("\n")}\nPruefe, ob einer davon dein Anliegen abdeckt.`,
              }],
              isError: true,
            };
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
        reportedBy: reportedBySchema,
      }),
    },
    async ({ id, reportedBy }) => {
      try {
        return withContext(workingDir, ({ taskService }) => {
          const task = taskService.completeTask(id, { reportedBy });
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
