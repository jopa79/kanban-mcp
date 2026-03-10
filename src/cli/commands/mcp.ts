// CLI Command: kanban mcp
import { Command } from "commander";
import { startMcpServer } from "../../mcp/server.ts";

export const mcpCommand = new Command("mcp")
  .description("MCP Server starten (fuer Claude Code Integration)")
  .option("-p, --path <path>", "Arbeitsverzeichnis fuer das Board")
  .action(async (options) => {
    const workingDir = options.path ?? process.cwd();
    await startMcpServer(workingDir);
  });
