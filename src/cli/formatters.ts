// Terminal-Ausgabe Formatierung mit Farben
import type { Column, Task } from "../core/types.ts";

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

  return `${id} ${title} ${COLORS.dim}|${COLORS.reset} ${col}${assignee}${labels}`;
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
  if (task.description) {
    lines.push(`${COLORS.dim}Beschreibung:${COLORS.reset}`);
    lines.push(`  ${task.description}`);
  }
  if (task.labels.length > 0) {
    lines.push(`${COLORS.dim}Labels:${COLORS.reset}     ${task.labels.join(", ")}`);
  }

  return lines.join("\n");
}

// Board-Status als kompakte Uebersicht
export function formatStatus(
  boardName: string,
  columns: Array<{ column: string; columnId: string; count: number }>,
  total: number,
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

  return lines.join("\n");
}

// Erfolgsmeldung
export function success(msg: string): void {
  console.log(`${COLORS.green}✓${COLORS.reset} ${msg}`);
}

// Fehlermeldung
export function error(msg: string): void {
  console.error(`${COLORS.red}✗${COLORS.reset} ${msg}`);
}
