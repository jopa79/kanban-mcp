#!/usr/bin/env bun
// Kanban MCP — CLI Entry Point
import { Command } from "commander";
// Einzige Quelle fuer die Versionsnummer -- package.json, nicht hier UND dort
// getrennt hochgezaehlt (siehe auch src/mcp/server.ts). package.json wird von
// npm/Bun beim Publish immer mitgeliefert, unabhaengig vom 'files'-Feld.
import pkg from "../package.json" with { type: "json" };
import { initCommand } from "./cli/commands/init.ts";
import { addCommand } from "./cli/commands/add.ts";
import { listCommand } from "./cli/commands/list.ts";
import { updateCommand } from "./cli/commands/update.ts";
import { moveCommand } from "./cli/commands/move.ts";
import { doneCommand } from "./cli/commands/done.ts";
import { statusCommand } from "./cli/commands/status.ts";
import { deleteCommand } from "./cli/commands/delete.ts";
import { mcpCommand } from "./cli/commands/mcp.ts";
import { tuiCommand } from "./cli/commands/tui.ts";
import { syncCommand } from "./cli/commands/sync.ts";
import { migrateCommand } from "./cli/commands/migrate.ts";
import { archiveCommand, restoreCommand, purgeCommand } from "./cli/commands/archive.ts";
import { getCommand } from "./cli/commands/get.ts";
import { noteCommand } from "./cli/commands/note.ts";
import { exportCommand } from "./cli/commands/export.ts";
import { importCommand } from "./cli/commands/import.ts";
import { boardsCommand } from "./cli/commands/boards.ts";

const program = new Command();

program
  .name("kanban")
  .description("Terminal Kanban Board mit MCP-Server")
  .version(pkg.version);

// CLI Commands registrieren
program.addCommand(initCommand);
program.addCommand(addCommand);
program.addCommand(listCommand);
program.addCommand(updateCommand);
program.addCommand(getCommand);
program.addCommand(moveCommand);
program.addCommand(doneCommand);
program.addCommand(statusCommand);
program.addCommand(deleteCommand);
program.addCommand(mcpCommand);
program.addCommand(tuiCommand);
program.addCommand(syncCommand);
program.addCommand(migrateCommand);
program.addCommand(noteCommand);
program.addCommand(archiveCommand);
program.addCommand(restoreCommand);
program.addCommand(purgeCommand);
program.addCommand(exportCommand);
program.addCommand(importCommand);
program.addCommand(boardsCommand);

program.parse();
