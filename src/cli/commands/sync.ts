// CLI Command: kanban sync
// Liest TodoWrite Hook-Input von stdin und synchronisiert ins Board
import { Command } from "commander";
import { boardExists, openDb, getBoardPaths } from "../../core/db.ts";
import { BoardService } from "../../core/board-service.ts";
import { TaskService } from "../../core/task-service.ts";

// TodoWrite Status -> Kanban Spalte
const STATUS_TO_COLUMN: Record<string, string> = {
  pending: "todo",
  in_progress: "in-progress",
  completed: "done",
  cancelled: "backlog",
};

interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "high" | "medium" | "low";
}

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
    const db = openDb(paths.dbPath);
    const boardService = new BoardService(db);
    const taskService = new TaskService(db, boardService);

    let created = 0;
    let moved = 0;
    let skipped = 0;

    try {
      const existingTasks = taskService.listTasks();

      for (const todo of todos) {
        const targetColumn = STATUS_TO_COLUMN[todo.status] ?? "todo";

        // Existierenden Task suchen: per Titel-Match
        const existing = existingTasks.find(
          (t) => t.title === todo.content || t.title === truncate(todo.content, 200),
        );

        if (existing) {
          // Task existiert — verschieben wenn noetig
          if (existing.columnId === targetColumn) {
            skipped++;
            continue;
          }
          if (targetColumn === "done") {
            taskService.completeTask(existing.id);
          } else {
            taskService.moveTask(existing.id, targetColumn);
          }
          moved++;
        } else {
          // Neuer Task erstellen
          if (todo.status === "cancelled") {
            skipped++;
            continue;
          }
          taskService.addTask({
            title: truncate(todo.content, 200),
            columnId: targetColumn,
            createdBy: "claude",
          });
          created++;
        }
      }

      db.close();

      // Ergebnis auf stderr (stdout ist reserviert)
      console.error(
        `kanban-mcp sync: ${created} erstellt, ${moved} verschoben, ${skipped} uebersprungen`,
      );
      process.exit(0);
    } catch (err) {
      db.close();
      console.error(`kanban-mcp sync error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}
