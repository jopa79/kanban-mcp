// Terminal-Ausgabe Formatierung mit Farben
import type { Task, TaskPriority } from "../core/types.ts";
import type { BoardOverviewEntry, BoardOverviewStatus } from "./board-overview.ts";

// ANSI Farb-Codes
const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

// Farbe pro Spalte
const COLUMN_COLORS: Record<string, string> = {
  backlog: COLORS.gray,
  todo: COLORS.yellow,
  "in-progress": COLORS.blue,
  review: COLORS.magenta,
  done: COLORS.green,
};

function colorForColumn(columnId: string): string {
  return COLUMN_COLORS[columnId] ?? COLORS.cyan;
}

// Farbe pro Prioritaet -- high am auffaelligsten, low am unauffaelligsten,
// damit die Farbe selbst schon die Dringlichkeit spiegelt.
function colorForPriority(priority: TaskPriority): string {
  if (priority === "high") return COLORS.red;
  if (priority === "medium") return COLORS.yellow;
  return COLORS.gray;
}

// Prioritaets-Marker fuer formatTask/formatTaskDetail (P2-2) -- "!high" statt
// nur "high", damit er sich im Fliesstext von Labels/Spaltennamen abhebt.
function formatPriorityMarker(priority: Task["priority"]): string {
  if (!priority) return "";
  return ` ${colorForPriority(priority)}!${priority}${COLORS.reset}`;
}

// Faelligkeits-Marker (P2-2): "⚠" nur wenn ueberfaellig -- derselbe Marker,
// den kanban status schon fuer Waisen nutzt (Aufmerksamkeit noetig), in Rot;
// eine kuenftige Faelligkeit bleibt unauffaellig gedimmt.
function formatDueDateMarker(task: Task): string {
  if (!task.dueDate) return "";
  if (task.isOverdue) {
    return ` ${COLORS.red}⚠ faellig ${task.dueDate}${COLORS.reset}`;
  }
  return ` ${COLORS.dim}faellig ${task.dueDate}${COLORS.reset}`;
}

// Task als Zeile formatieren
export function formatTask(task: Task): string {
  const color = colorForColumn(task.columnId);
  const id = `${COLORS.dim}[${task.id.slice(0, 8)}]${COLORS.reset}`;
  const title = `${COLORS.bold}${task.title}${COLORS.reset}`;
  const col = `${color}${task.columnId}${COLORS.reset}`;
  const assignee = task.assignedTo
    ? ` ${COLORS.dim}@${task.assignedTo}${COLORS.reset}`
    : "";
  const labels = task.labels.length > 0
    ? ` ${COLORS.cyan}[${task.labels.join(", ")}]${COLORS.reset}`
    : "";
  const priority = formatPriorityMarker(task.priority);
  const due = formatDueDateMarker(task);

  return `${id} ${title} ${COLORS.dim}|${COLORS.reset} ${col}${assignee}${labels}${priority}${due}`;
}

// Task-Details formatieren
export function formatTaskDetail(task: Task): string {
  const lines: string[] = [
    `${COLORS.bold}${task.title}${COLORS.reset}`,
    `${COLORS.dim}ID:${COLORS.reset}         ${task.id}`,
    `${COLORS.dim}Spalte:${COLORS.reset}     ${colorForColumn(task.columnId)}${task.columnId}${COLORS.reset}`,
    `${COLORS.dim}Erstellt:${COLORS.reset}   ${task.createdBy} @ ${task.createdAt}`,
  ];

  if (task.assignedTo) {
    lines.push(`${COLORS.dim}Zugewiesen:${COLORS.reset} ${task.assignedTo}`);
  }
  if (task.priority) {
    lines.push(`${COLORS.dim}Prioritaet:${COLORS.reset}  ${colorForPriority(task.priority)}${task.priority}${COLORS.reset}`);
  }
  if (task.dueDate) {
    const overdueNote = task.isOverdue ? ` ${COLORS.red}⚠ ueberfaellig${COLORS.reset}` : "";
    lines.push(`${COLORS.dim}Faellig:${COLORS.reset}     ${task.dueDate}${overdueNote}`);
  }
  if (task.description) {
    lines.push(`${COLORS.dim}Beschreibung:${COLORS.reset}`);
    lines.push(`  ${task.description}`);
  }
  if (task.labels.length > 0) {
    lines.push(`${COLORS.dim}Labels:${COLORS.reset}     ${task.labels.join(", ")}`);
  }

  return lines.join("\n");
}

// Board-Status als kompakte Uebersicht. 'orphanCount' (P1-6, ADR 0001): Tasks,
// deren Spalte in config.json fehlt -- werden separat ausgewiesen, nicht in
// einer der regulaeren Spaltenzeilen versteckt. 'total' rechnet sie NICHT
// automatisch mit ein: formatStatus rendert nur, was der Aufrufer uebergibt,
// die Verantwortung fuer eine korrekte Summe liegt bei status.ts.
export function formatStatus(
  boardName: string,
  columns: Array<{ column: string; columnId: string; count: number }>,
  total: number,
  orphanCount = 0,
): string {
  const lines: string[] = [
    `${COLORS.bold}${boardName}${COLORS.reset} ${COLORS.dim}(${total} Tasks)${COLORS.reset}`,
    "",
  ];

  for (const col of columns) {
    const color = colorForColumn(col.columnId);
    const bar = "█".repeat(Math.min(col.count, 20));
    lines.push(
      `  ${color}${col.column.padEnd(12)}${COLORS.reset} ${COLORS.dim}${col.count.toString().padStart(3)}${COLORS.reset} ${color}${bar}${COLORS.reset}`,
    );
  }

  if (orphanCount > 0) {
    lines.push(
      `  ${COLORS.yellow}⚠ Ohne Spalte${COLORS.reset} ${COLORS.dim}${orphanCount.toString().padStart(3)}${COLORS.reset}`,
    );
  }

  return lines.join("\n");
}

// Registrierte Boards als Tabelle ('kanban boards', P3-1 zweite Haelfte).
// Zeigt gerade dann etwas Sinnvolles an, wenn ein Board kaputt ist -- eine
// leere Zeile oder ein Absturz waere hier das falsche Verhalten (Task-Notiz).
export function formatBoardsList(entries: BoardOverviewEntry[]): string {
  if (entries.length === 0) {
    return `${COLORS.dim}Keine Boards registriert. 'kanban boards add [pfad]' um eines hinzuzufuegen.${COLORS.reset}`;
  }

  const nameWidth = Math.max(4, ...entries.map((e) => e.name.length));
  const pathWidth = Math.max(4, ...entries.map((e) => e.path.length));

  const lines: string[] = [
    `${COLORS.bold}Registrierte Boards${COLORS.reset} ${COLORS.dim}(${entries.length})${COLORS.reset}`,
    "",
  ];

  for (const entry of entries) {
    const name = `${COLORS.bold}${entry.name.padEnd(nameWidth)}${COLORS.reset}`;
    const path = `${COLORS.dim}${entry.path.padEnd(pathWidth)}${COLORS.reset}`;
    lines.push(`  ${name} ${path} ${formatBoardStatus(entry.status)}`);
  }

  return lines.join("\n");
}

// Statuszeile je Board: Task-Zahl im Normalfall, sonst eine Warnung statt
// Absturz. 'missing'/'schema-outdated' in Gelb (Aufmerksamkeit noetig, aber
// kein hartes Scheitern), generische Fehler (kaputte config.json, gesperrte
// DB) in Rot -- dieselbe Farblogik wie formatPriorityMarker.
function formatBoardStatus(status: BoardOverviewStatus): string {
  if (status.kind === "ok") {
    return `${COLORS.dim}${status.taskCount.toString().padStart(3)} Tasks${COLORS.reset}`;
  }
  if (status.kind === "missing") {
    return `${COLORS.yellow}⚠ Pfad existiert nicht mehr${COLORS.reset}`;
  }
  if (status.kind === "schema-outdated") {
    return `${COLORS.yellow}⚠ Schema v${status.version} -- 'kanban migrate' noetig${COLORS.reset}`;
  }
  return `${COLORS.red}⚠ ${status.message}${COLORS.reset}`;
}

// Erfolgsmeldung
export function success(msg: string): void {
  console.log(`${COLORS.green}✓${COLORS.reset} ${msg}`);
}

// Fehlermeldung
export function error(msg: string): void {
  console.error(`${COLORS.red}✗${COLORS.reset} ${msg}`);
}
