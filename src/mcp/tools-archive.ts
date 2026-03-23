// MCP Tools fuer Archiv-Management
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { withContext } from "./mcp-context.ts";

export function registerArchiveTools(server: McpServer, workingDir: string): void {
  // --- kanban_archive_tasks ---
  server.registerTool(
    "kanban_archive_tasks",
    {
      title: "Tasks archivieren",
      description: "Erledigte Tasks archivieren. Default: aus Done-Spalte.",
      inputSchema: z.object({
        columnId: z.string().optional().describe("Aus bestimmter Spalte archivieren"),
        olderThanDays: z.number().optional().describe("Nur Tasks aelter als N Tage"),
        dryRun: z.boolean().optional().describe("Vorschau ohne Aenderung"),
      }),
    },
    async ({ columnId, olderThanDays, dryRun }) => {
      try {
        return withContext(workingDir, ({ taskService }) => {
          const result = taskService.archiveTasks({ columnId, olderThanDays, dryRun });
          const prefix = dryRun ? "[Vorschau] " : "";
          return { content: [{ type: "text", text: `${prefix}${result.archivedCount} Tasks archiviert` }] };
        });
      } catch (err) {
        return { content: [{ type: "text", text: `Fehler: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // --- kanban_restore_task ---
  server.registerTool(
    "kanban_restore_task",
    {
      title: "Task wiederherstellen",
      description: "Archivierten Task wiederherstellen",
      inputSchema: z.object({
        id: z.string().describe("Task-ID"),
        columnId: z.string().optional().describe("Ziel-Spalte (default: todo)"),
      }),
    },
    async ({ id, columnId }) => {
      try {
        return withContext(workingDir, ({ taskService }) => {
          const task = taskService.restoreTask(id, columnId);
          return { content: [{ type: "text", text: `Task wiederhergestellt: "${task.title}" (ID: ${task.id}) → ${task.columnId}` }] };
        });
      } catch (err) {
        return { content: [{ type: "text", text: `Fehler: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // --- kanban_purge_archive ---
  server.registerTool(
    "kanban_purge_archive",
    {
      title: "Archiv loeschen",
      description: "Alle archivierten Tasks permanent loeschen",
      inputSchema: z.object({
        confirm: z.boolean().describe("Muss true sein zum Bestaetigen"),
        dryRun: z.boolean().optional().describe("Vorschau ohne Aenderung"),
      }),
    },
    async ({ confirm, dryRun }) => {
      try {
        return withContext(workingDir, ({ taskService }) => {
          if (dryRun) {
            const result = taskService.purgeArchive({ dryRun: true });
            return { content: [{ type: "text", text: `[Vorschau] ${result.purgedCount} Tasks wuerden geloescht` }] };
          }
          if (!confirm) {
            return { content: [{ type: "text", text: "confirm muss true sein" }], isError: true };
          }
          const result = taskService.purgeArchive();
          return { content: [{ type: "text", text: `Archiv geleert: ${result.purgedCount} Tasks permanent geloescht` }] };
        });
      } catch (err) {
        return { content: [{ type: "text", text: `Fehler: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // --- kanban_archive_stats ---
  server.registerTool(
    "kanban_archive_stats",
    {
      title: "Archiv-Statistiken",
      description: "Anzahl archivierter Tasks und Verteilung nach Spalten",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        return withContext(workingDir, ({ taskService }) => {
          const stats = taskService.getArchiveStats();
          return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
        });
      } catch (err) {
        return { content: [{ type: "text", text: `Fehler: ${(err as Error).message}` }], isError: true };
      }
    },
  );
}
