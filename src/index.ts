#!/usr/bin/env bun
// Kanban MCP — CLI Entry Point
import { Command } from "commander";
import { initCommand } from "./cli/commands/init.ts";
import { addCommand } from "./cli/commands/add.ts";
import { listCommand } from "./cli/commands/list.ts";
import { moveCommand } from "./cli/commands/move.ts";
import { doneCommand } from "./cli/commands/done.ts";
import { statusCommand } from "./cli/commands/status.ts";
import { deleteCommand } from "./cli/commands/delete.ts";
import { mcpCommand } from "./cli/commands/mcp.ts";
import { tuiCommand } from "./cli/commands/tui.ts";
import { syncCommand } from "./cli/commands/sync.ts";
import { archiveCommand, restoreCommand, purgeCommand } from "./cli/commands/archive.ts";
import { getCommand } from "./cli/commands/get.ts";
import { noteCommand } from "./cli/commands/note.ts";
import { exportCommand } from "./cli/commands/export.ts";
import { importCommand } from "./cli/commands/import.ts";

const program = new Command();

program
  .name("kanban")
  .description("Terminal Kanban Board mit MCP-Server")
  .version("0.1.0");

// CLI Commands registrieren
program.addCommand(initCommand);
program.addCommand(addCommand);
program.addCommand(listCommand);
program.addCommand(getCommand);
program.addCommand(moveCommand);
program.addCommand(doneCommand);
program.addCommand(statusCommand);
program.addCommand(deleteCommand);
program.addCommand(mcpCommand);
program.addCommand(tuiCommand);
program.addCommand(syncCommand);
program.addCommand(noteCommand);
program.addCommand(archiveCommand);
program.addCommand(restoreCommand);
program.addCommand(purgeCommand);
program.addCommand(exportCommand);
program.addCommand(importCommand);

program.parse();
