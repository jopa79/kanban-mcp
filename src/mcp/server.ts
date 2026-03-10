// MCP Server — Stdio Transport
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.ts";

export async function startMcpServer(workingDir: string): Promise<void> {
  const server = new McpServer(
    { name: "kanban-mcp", version: "0.1.0" },
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
