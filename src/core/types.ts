// Basis-Typen fuer das Kanban Board

// Domain-Objekt einer Spalte. 'position' wird beim Laden aus dem Index im
// config.columns-Array abgeleitet und nie aus der Datei gelesen (siehe
// ColumnConfig und ADR 0001).
export interface Column {
  id: string;
  name: string;
  position: number;
  wipLimit: number;
  allowEntry: boolean;
  isTerminal: boolean;
}

// Sentinel-ID der virtuellen Sammelspalte fuer Waisen-Tasks (P1-6, ADR 0001).
// Kein Task hat diese column_id jemals real in der DB — sie taucht nur in der
// aus 'columns' abgeleiteten Anzeige-Liste auf (siehe use-board.ts:
// displayColumns/isOrphanTask, board-view.tsx).
//
// Steht hier und nicht in tui/theme.ts, weil es ein Domaenenbegriff ist und
// keine Darstellungsfrage: config.json darf die ID nicht vergeben, und diese
// Regel gehoert zur Validierung in dieser Datei. 'core' darf nicht aus 'tui'
// importieren — die Abhaengigkeit laeuft nur in diese Richtung.
export const ORPHAN_COLUMN_ID = "__orphan__";

// Spalten-IDs, die config.json nicht vergeben darf, weil die Anzeige sie fuer
// virtuelle Spalten belegt. Traefe eine echte Spalte auf eine davon, stuenden
// zwei Eintraege mit derselben ID in der Anzeige-Liste (board-view.tsx) und
// kollidierten als React-Key.
export const RESERVED_COLUMN_IDS: readonly string[] = [ORPHAN_COLUMN_ID];

// Prioritaet eines Tasks — echte, sortierbare Spalte seit Schema v3 (Paket 0),
// durchgereicht ueber CLI/MCP seit Paket 2 (P2-1/P2-2). Echte Spalte statt
// Label, weil nur eine Spalte eine Ordnung hat: 'priority:high' als Label
// waere filterbar gewesen, aber nicht sortierbar (siehe Plan Abschnitt 4.5 --
// derselbe Grund gilt fuer dueDate).
export type TaskPriority = "high" | "medium" | "low";

// In Sortier-Reihenfolge (high zuerst) -- exportiert, damit CLI-Hilfetexte,
// MCP-.describe()-Texte und die Validierung dieselbe Liste zeigen, statt drei
// Kopien zu pflegen, die auseinanderlaufen koennen.
export const TASK_PRIORITIES: readonly TaskPriority[] = ["high", "medium", "low"];

// Prueft eine rohe Prioritaets-Eingabe aus CLI/MCP (immer nur 'string', nie
// TaskPriority -- der Typchecker kann eine Laufzeit-Eingabe nicht einschraenken).
// undefined ("nicht angegeben") und null ("explizit zuruecksetzen") sind immer
// gueltig und werden durchgereicht; nur ein tatsaechlicher Wert wird gegen
// TASK_PRIORITIES geprueft. Wirft mit einer Meldung, die die gueltigen Werte
// aufzaehlt (Stil der Zustandsmaschine: sagen was gilt, nicht nur was falsch ist).
export function assertValidTaskPriority(value: string | null | undefined): void {
  if (value === undefined || value === null) return;
  if (!TASK_PRIORITIES.includes(value as TaskPriority)) {
    throw new Error(
      `Ungueltige Prioritaet: '${value}'. Gueltige Werte: ${TASK_PRIORITIES.join(", ")}.`,
    );
  }
}

// Format fuer Faelligkeitsdaten: ISO-Datum ohne Uhrzeit, damit der reine
// String sowohl sortierbar als auch mit einem "heute"-String vergleichbar ist
// (siehe TaskService.isOverdue).
const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Prueft ein rohes Faelligkeitsdatum: Format UND Kalendergueltigkeit.
// new Date("2026-02-31") wirft NICHT, sondern rollt still auf den 3. Maerz um
// -- ein reiner Parse-Versuch waere also keine verlaessliche Pruefung.
// Stattdessen: Jahr/Monat/Tag einzeln herausgezogen, ein Date daraus gebaut
// und die drei Komponenten zurueckverglichen -- rollt JS um, weichen sie ab.
// Vergangene Daten sind gueltig (man traegt auch Ueberfaelliges nach), nur
// die kalendarische EXISTENZ des Datums wird geprueft, nicht seine Lage in
// der Zeit.
export function assertValidDueDate(value: string | null | undefined): void {
  if (value === undefined || value === null) return;

  if (!DUE_DATE_PATTERN.test(value)) {
    throw new Error(
      `Ungueltiges Faelligkeitsdatum: '${value}'. Erwartet wird das Format YYYY-MM-DD (z.B. 2026-08-01).`,
    );
  }

  const [yearStr, monthStr, dayStr] = value.split("-") as [string, string, string];
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const roundTrip = new Date(year, month - 1, day);
  const isRealCalendarDate =
    roundTrip.getFullYear() === year &&
    roundTrip.getMonth() === month - 1 &&
    roundTrip.getDate() === day;

  if (!isRealCalendarDate) {
    throw new Error(
      `Ungueltiges Faelligkeitsdatum: '${value}' existiert im Kalender nicht.`,
    );
  }
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  columnId: string;
  createdBy: string;
  assignedTo: string | null;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  version: number;
  position: number;
  priority: TaskPriority | null;
  dueDate: string | null;
  notes?: string | null;
  hasNotes?: boolean;
  isBlocked?: boolean;
  // P2-1: abgeleitet (dueDate < heute && !archived && Spalte nicht terminal),
  // nicht gespeichert -- analog zu isBlocked nicht in rowToTask, sondern in
  // TaskService.getTask()/listTasks() gesetzt (siehe TaskService.isOverdue).
  isOverdue?: boolean;
}

// Spalten-Definition wie sie in config.json steht — bewusst OHNE 'position'.
// Die Array-Reihenfolge in BoardConfig.columns IST die Reihenfolge (ADR 0001).
export interface ColumnConfig {
  id: string;
  name: string;
  wipLimit: number;
  allowEntry: boolean;
  isTerminal: boolean;
}

export interface BoardConfig {
  name: string;
  createdAt: string;
  schemaVersion: number;
  columns: ColumnConfig[];
}

// Input-Typen fuer Operationen

export interface AddTaskInput {
  title: string;
  description?: string;
  columnId?: string;
  createdBy?: string;
  assignedTo?: string;
  labels?: string[];
  dependsOn?: string[];
  notes?: string;
  // P1-3 (K-3): getrennt von createdBy -- gilt nur fuer die Entstehungs-
  // Transition, nicht fuer tasks.created_by. Optional auf Service-Ebene
  // (CLI/TUI/Skripte duerfen es weglassen, Default "user"); an der
  // MCP-Werkzeugoberflaeche wird es zum Pflichtfeld (siehe tools.ts).
  reportedBy?: string;
  // P2-1: bewusst 'string', nicht 'TaskPriority' -- CLI/MCP liefern rohe,
  // ungeprueften Text. TaskService validiert (assertValidTaskPriority) und
  // wirft mit einer Meldung, die die gueltigen Werte aufzaehlt, statt sich
  // auf den Typchecker zu verlassen, der zur Laufzeit ohnehin nicht greift.
  priority?: string | null;
  dueDate?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  assignedTo?: string | null;
  labels?: string[];
  notes?: string | null;
  priority?: string | null;
  dueDate?: string | null;
}

// Optionen fuer TaskService.moveTask (P1-2).
// - 'override': umgeht Kettenregel UND WIP-Limit vollstaendig (nur TUI, siehe
//   ADR 0002) und markiert die Transition mit was_override = 1.
// - 'wipPolicy: "log"': fuer den kommenden Sync (P1-7) -- ein WIP-Verstoss
//   wird protokolliert (was_override = 1, Default-reason "wip-exceeded
//   (sync)") statt abgelehnt. Die Kettenregel bleibt dabei hart, TodoWrite
//   ist nicht ablehnbar, aber auch nicht befugt, die Kette zu brechen.
export interface MoveTaskOptions {
  reportedBy?: string;
  reason?: string | null;
  override?: boolean;
  wipPolicy?: "reject" | "log";
}

export interface ListTasksFilter {
  columnId?: string;
  createdBy?: string;
  assignedTo?: string;
  includeArchived?: boolean;
  // P2-1: lose typisiert (nicht TaskPriority) -- ein unbekannter Filterwert
  // ist kein Fehler, er liefert schlicht keine Treffer. Anders als beim
  // SETZEN einer Prioritaet gibt es beim FILTERN nichts zu validieren.
  priority?: string;
  // Nur Tasks mit TaskService.isOverdue() === true.
  overdue?: boolean;
  // Sortierung ist optional, Default bleibt position/created_at (siehe
  // TaskService.buildOrderBy) -- sonst zerreisst es die manuelle Reihenfolge,
  // die z.B. die TUI ueber reorderTask() pflegt. Lose typisiert (nicht als
  // Union): CLI-Optionen kommen als roher String an, ein unbekannter Wert
  // faellt auf die Default-Sortierung zurueck statt zu werfen -- Sortierung
  // ist eine Praesentationsfrage, keine Regel, die eine Ablehnung verdient.
  sort?: string;
}

export interface AddTaskCheckedResult {
  task: Task | null;
  rejected: boolean;
  rejectionReason: string | null;
  similarTasks: Task[];
}

// Datenbank-Row Typen (wie SQLite sie liefert)

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  column_id: string;
  created_by: string;
  assigned_to: string | null;
  labels: string | null;
  created_at: string;
  updated_at: string;
  archived: number;
  version: number;
  position: number;
  priority: string | null;
  due_date: string | null;
}

// Hilfsfunktionen: DB-Row -> Domain-Objekt

export function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    columnId: row.column_id,
    createdBy: row.created_by,
    assignedTo: row.assigned_to,
    labels: row.labels ? JSON.parse(row.labels) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archived: row.archived === 1,
    version: row.version,
    position: row.position ?? 0,
    priority: (row.priority as TaskPriority | null) ?? null,
    dueDate: row.due_date ?? null,
  };
}

// Zustandsuebergang eines Tasks (Schema v3, Paket 0). Wird ab Paket 1
// (transition-service.ts) befuellt — hier nur Typ und Row-Mapping, analog zu
// Task/TaskRow/rowToTask. Siehe Plan Abschnitt 2.1 und Kanban-Task N8-B1V7SnbFx.
export interface Transition {
  id: number;
  taskId: string;
  fromColumn: string | null; // NULL = Task-Entstehung
  toColumn: string;
  reportedBy: string;
  reason: string | null;
  wasOverride: boolean;
  createdAt: string;
}

export interface TransitionRow {
  id: number;
  task_id: string;
  from_column: string | null;
  to_column: string;
  reported_by: string;
  reason: string | null;
  was_override: number;
  created_at: string;
}

export function rowToTransition(row: TransitionRow): Transition {
  return {
    id: row.id,
    taskId: row.task_id,
    fromColumn: row.from_column,
    toColumn: row.to_column,
    reportedBy: row.reported_by,
    reason: row.reason,
    wasOverride: row.was_override === 1,
    createdAt: row.created_at,
  };
}

// Validiert eine rohe config.json-Struktur und liefert eine typsichere BoardConfig.
// Wirft bei jedem Fehler eine verstaendliche Meldung auf Deutsch — der Pfad zur
// Datei wird hier bewusst NICHT ergaenzt (validateBoardConfig kennt den Pfad
// nicht), das macht der Aufrufer (siehe loadBoardConfig in db.ts).
export function validateBoardConfig(raw: unknown): BoardConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("config.json: Inhalt ist kein Objekt");
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.name !== "string") {
    throw new Error("config.json: Feld 'name' fehlt oder ist kein String");
  }
  if (typeof obj.createdAt !== "string") {
    throw new Error("config.json: Feld 'createdAt' fehlt oder ist kein String");
  }
  if (typeof obj.schemaVersion !== "number") {
    throw new Error("config.json: Feld 'schemaVersion' fehlt oder ist keine Zahl");
  }
  if (!Array.isArray(obj.columns)) {
    throw new Error("config.json: Feld 'columns' fehlt oder ist kein Array");
  }
  if (obj.columns.length === 0) {
    throw new Error("config.json: 'columns' ist leer — mindestens eine Spalte noetig");
  }

  const columns: ColumnConfig[] = obj.columns.map((rawCol, index) =>
    validateColumnConfig(rawCol, index),
  );

  const ids = new Set<string>();
  for (const col of columns) {
    if (ids.has(col.id)) {
      throw new Error(`config.json: doppelte Spalten-id '${col.id}'`);
    }
    ids.add(col.id);
  }

  const terminalColumns = columns.filter((c) => c.isTerminal);
  if (terminalColumns.length === 0) {
    throw new Error("config.json: keine Spalte mit isTerminal: true — es muss genau eine geben");
  }
  if (terminalColumns.length > 1) {
    const names = terminalColumns.map((c) => c.id).join(", ");
    throw new Error(
      `config.json: mehrere Spalten mit isTerminal: true (${names}) — es darf genau eine geben`,
    );
  }

  if (!columns.some((c) => c.allowEntry)) {
    throw new Error(
      "config.json: keine Spalte mit allowEntry: true — mindestens eine Eintrittsspalte noetig",
    );
  }

  return {
    name: obj.name,
    createdAt: obj.createdAt,
    schemaVersion: obj.schemaVersion,
    columns,
  };
}

// Validiert ein einzelnes rohes Spaltenobjekt aus config.json.
function validateColumnConfig(raw: unknown, index: number): ColumnConfig {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`config.json: Spalte an Index ${index} ist kein Objekt`);
  }
  const col = raw as Record<string, unknown>;

  if (typeof col.id !== "string" || col.id.length === 0) {
    throw new Error(`config.json: Spalte an Index ${index} hat keine gueltige 'id'`);
  }
  // Reservierte IDs gehoeren den virtuellen Anzeige-Spalten. Eine echte Spalte
  // mit derselben ID waere in der Anzeige doppelt vorhanden — deshalb hier
  // ablehnen statt es spaeter im Rendern auffallen zu lassen.
  if (RESERVED_COLUMN_IDS.includes(col.id)) {
    throw new Error(
      `config.json: Spalte an Index ${index} verwendet die reservierte 'id' '${col.id}' — ` +
      "diese ID gehoert einer virtuellen Anzeige-Spalte, bitte eine andere waehlen",
    );
  }
  if (typeof col.name !== "string" || col.name.length === 0) {
    throw new Error(`config.json: Spalte '${col.id}' hat keinen gueltigen 'name'`);
  }
  if (typeof col.wipLimit !== "number") {
    throw new Error(`config.json: Spalte '${col.id}' hat kein gueltiges 'wipLimit'`);
  }
  if (typeof col.allowEntry !== "boolean") {
    throw new Error(`config.json: Spalte '${col.id}' hat kein gueltiges 'allowEntry'`);
  }
  if (typeof col.isTerminal !== "boolean") {
    throw new Error(`config.json: Spalte '${col.id}' hat kein gueltiges 'isTerminal'`);
  }
  // 'position' entfaellt bewusst (ADR 0001) — die Array-Reihenfolge ist die Ordnung.
  // Ein vorhandenes Feld in der Datei ist ein Fehler, kein ignoriertes Extra, sonst
  // glaubt jemand, es haette eine Wirkung.
  if ("position" in col) {
    throw new Error(
      `config.json: Spalte '${col.id}' enthaelt ein 'position'-Feld — die Reihenfolge ` +
      "im Array ist die Position, ein eigenes Feld wird ignoriert und ist deshalb ein Fehler",
    );
  }

  return {
    id: col.id,
    name: col.name,
    wipLimit: col.wipLimit,
    allowEntry: col.allowEntry,
    isTerminal: col.isTerminal,
  };
}
