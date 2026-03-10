// MCP Tools fuer Board Export/Import
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { exportBoard, importBoard } from "../core/export-service.ts";

export function registerExportTools(server: McpServer, workingDir: string): void {
  // --- kanban_export_board ---
  server.registerTool(
    "kanban_export_board",
    {
      title: "Board exportieren",
      description: "Board als ZIP-Archiv exportieren (board.json + Notes)",
      inputSchema: z.object({
        outputPath: z.string().optional().describe("Pfad fuer die ZIP-Datei (default: ./kanban-export-{datum}.zip)"),
      }),
    },
    async ({ outputPath }) => {
      try {
        const zipPath = await exportBoard(workingDir, outputPath);
        return { content: [{ type: "text", text: `Board exportiert nach ${zipPath}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Fehler: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  // --- kanban_import_board ---
  server.registerTool(
    "kanban_import_board",
    {
      title: "Board importieren",
      description: "Board aus ZIP-Archiv importieren",
      inputSchema: z.object({
        zipPath: z.string().describe("Pfad zur ZIP-Datei"),
        force: z.boolean().optional().describe("Bestehendes Board ueberschreiben (default: false)"),
      }),
    },
    async ({ zipPath, force }) => {
      try {
        await importBoard(workingDir, zipPath, { force });
        return { content: [{ type: "text", text: "Board erfolgreich importiert" }] };
      } catch (err) {
        return { content: [{ type: "text", text: `Fehler: ${(err as Error).message}` }], isError: true };
      }
    },
  );
}
