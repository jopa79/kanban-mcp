// MCP Server — Stdio Transport
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.ts";
// Einzige Quelle fuer die Versionsnummer -- package.json, nicht hier UND in
// src/index.ts getrennt hochgezaehlt.
import pkg from "../../package.json" with { type: "json" };

export async function startMcpServer(workingDir: string): Promise<void> {
  const server = new McpServer(
    { name: "kanban-mcp", version: pkg.version },
    { capabilities: { tools: {} } },
  );

  // Alle Tools registrieren
  registerTools(server, workingDir);

  // Stdio Transport starten
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Info auf stderr (stdout ist fuer MCP Protokoll reserviert)
  console.error("Kanban MCP Server laeuft auf stdio");
}
