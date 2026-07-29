// CLI Command: kanban sync
// Liest TodoWrite Hook-Input von stdin und synchronisiert ins Board.
// Reine Huelle (P1-7): stdin lesen, parsen, an syncTodos()
// (src/core/sync-service.ts) uebergeben, Bericht auf stderr ausgeben. Die
// eigentliche Logik lebt bewusst NICHT hier, sonst waechst die Datei ueber
// 300 Zeilen und ist nur ueber simuliertes stdin testbar (Plan Abschnitt 3.9).
import { Command } from "commander";
import type { Database } from "bun:sqlite";
import { boardExists, openDb, getBoardPaths, loadBoardConfig } from "../../core/db.ts";
import { BoardService } from "../../core/board-service.ts";
import { TaskService } from "../../core/task-service.ts";
import { NotesService } from "../../core/notes-service.ts";
import { syncTodos, type TodoItem } from "../../core/sync-service.ts";

interface HookInput {
  cwd: string;
  tool_input: {
    todos: TodoItem[];
  };
}

export const syncCommand = new Command("sync")
  .description("TodoWrite-Input von stdin ins Board synchronisieren")
  .action(async () => {
    // Stdin lesen
    let input: string;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      input = Buffer.concat(chunks).toString("utf-8");
    } catch {
      process.exit(0);
    }

    if (!input.trim()) {
      process.exit(0);
    }

    let parsed: HookInput;
    try {
      parsed = JSON.parse(input);
    } catch {
      process.exit(0);
    }

    const cwd = parsed.cwd;
    const todos = parsed.tool_input?.todos;

    if (!todos || todos.length === 0) {
      process.exit(0);
    }

    // Board pruefen
    if (!boardExists(cwd)) {
      // Kein Board im Arbeitsverzeichnis — still beenden
      process.exit(0);
    }

    const paths = getBoardPaths(cwd);

    // DB oeffnen + Services aufbauen. Schema-Guard (P0-5) oder eine kaputte
    // config.json werfen hier — ein Hook, der einen Agenten-Turn mit Exit 1
    // stoert, richtet mehr Schaden an als ein ausgefallener Sync. Deshalb
    // Exit 0 mit Meldung auf stderr, dieselbe Konvention wie oben bei
    // fehlendem Board (dort still, hier mit sichtbarer Meldung — das Board
    // existiert ja, laesst sich nur nicht oeffnen).
    let db: Database;
    let boardService: BoardService;
    let taskService: TaskService;
    try {
      db = openDb(paths.dbPath);
      const config = loadBoardConfig(paths.configPath);
      boardService = new BoardService(db, config);
      const notesService = new NotesService(paths.kanbanDir);
      taskService = new TaskService(db, boardService, notesService);
    } catch (err) {
      console.error(`kanban-mcp sync: ${(err as Error).message}`);
      process.exit(0);
    }

    try {
      const report = syncTodos(db, taskService, boardService, todos);
      db.close();

      // Ergebnis auf stderr (stdout ist reserviert)
      console.error(
        `kanban-mcp sync: ${report.created} erstellt, ${report.moved} verschoben, ${report.skipped} uebersprungen`,
      );
      // WIP-Verstoesse werden durchgewunken statt abgelehnt (TodoWrite ist
      // nicht ablehnbar, der Hook laeuft erst nachdem der Agent den Zustand
      // gesetzt hat) — aber sichtbar gemacht, nicht verschwiegen.
      if (report.wipOverrides > 0) {
        console.error(
          `kanban-mcp sync: ${report.wipOverrides} WIP-Ueberschreitung(en) geloggt (nicht abgelehnt) — Details: kanban status`,
        );
      }
      process.exit(0);
    } catch (err) {
      db.close();
      console.error(`kanban-mcp sync error: ${(err as Error).message}`);
      process.exit(1);
    }
  });
