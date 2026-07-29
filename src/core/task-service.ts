// Task CRUD und Bewegungslogik
import type { Database, SQLQueryBindings } from "bun:sqlite";
import { nanoid } from "nanoid";
import type { BoardService } from "./board-service.ts";
import { DependencyService } from "./dependency-service.ts";
import type {
  AddTaskCheckedResult,
  AddTaskInput,
  Column,
  ListTasksFilter,
  MoveTaskOptions,
  Task,
  TaskRow,
  UpdateTaskInput,
} from "./types.ts";
import { assertValidDueDate, assertValidTaskPriority, rowToTask } from "./types.ts";
import { similarity, SIMILARITY_THRESHOLD } from "./similarity.ts";
import type { TransitionCheck } from "./transition-service.ts";

// Heutiges Datum als YYYY-MM-DD in LOKALER Zeit (nicht UTC via toISOString()
// -- das wuerde einen Task kurz nach Mitternacht UTC faelschlich schon fuer
// "morgen" faellig halten). Fuer TaskService.isOverdue().
function todayLocalIso(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// TaskService erbt Archiv-Funktionen (ArchiveService) und Dependency-
// Verwaltung (DependencyService, Refactoring hs_Zn8_sXJia) ueber die
// Vererbungskette.
export class TaskService extends DependencyService {

  // Neuen Task erstellen
  addTask(input: AddTaskInput): Task {
    const id = nanoid(12);
    const now = new Date().toISOString();
    const columnId = input.columnId ?? "todo";

    // P1-2: nur noch Eintrittsspalten (allowEntry: true) erlaubt -- ersetzt
    // die reine Existenzpruefung, deckt sie aber mit ab (canEnter lehnt auch
    // unbekannte Spalten ab, siehe transition-service.ts).
    const entryCheck = this.transitionService.canEnter(columnId);
    if (!entryCheck.allowed) {
      throw new Error(entryCheck.reason);
    }

    // P2-1: Validierung lebt im Service, nicht in CLI/MCP -- eine Eingabe
    // kommt von dort immer als roher String, nie typgeprueft.
    assertValidTaskPriority(input.priority);
    assertValidDueDate(input.dueDate);

    // Position: ans Ende der Zielspalte
    const maxPos = this.db
      .query("SELECT COALESCE(MAX(position), -1) as max_pos FROM tasks WHERE column_id = ? AND archived = 0")
      .get(columnId) as { max_pos: number };
    const position = maxPos.max_pos + 1;

    this.db.run(
      `INSERT INTO tasks (id, title, description, column_id, created_by, assigned_to, labels, position, created_at, updated_at, priority, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.title,
        input.description ?? null,
        columnId,
        input.createdBy ?? "user",
        input.assignedTo ?? null,
        input.labels ? JSON.stringify(input.labels) : null,
        position,
        now,
        now,
        input.priority ?? null,
        input.dueDate ?? null,
      ],
    );

    if (input.dependsOn?.length) {
      const insertDep = this.db.prepare(
        "INSERT OR IGNORE INTO dependencies (task_id, depends_on_id) VALUES (?, ?)"
      );
      for (const depId of input.dependsOn) {
        insertDep.run(id, depId);
      }
    }

    // Notes speichern falls mitgeliefert
    if (input.notes) {
      this.notesService.save(id, input.notes);
    }

    // Entstehung protokollieren: from_column = NULL markiert den Task-Ursprung
    // (siehe rowToTransition / Plan Abschnitt 2.1). reportedBy ist bewusst
    // getrennt von createdBy (K-3, P1-3) -- kein Fallback auf createdBy, sonst
    // waeren die beiden Felder faktisch dasselbe.
    this.transitionService.log(id, null, columnId, input.reportedBy ?? "user", null, false);

    return this.getTask(id)!;
  }

  // Task mit Duplikat-Erkennung erstellen
  addTaskChecked(input: AddTaskInput, options?: { force?: boolean }): AddTaskCheckedResult {
    const existingTasks = this.listTasks();

    const similarTasks = existingTasks.filter(
      (t) => similarity(t.title, input.title) >= SIMILARITY_THRESHOLD,
    );

    const exactMatch = existingTasks.find(
      (t) => t.title.toLowerCase() === input.title.toLowerCase(),
    );

    if (exactMatch && !options?.force) {
      return {
        task: null,
        rejected: true,
        rejectionReason: `Task mit gleichem Titel existiert bereits: [${exactMatch.id.slice(0, 8)}] "${exactMatch.title}" (${exactMatch.columnId})`,
        similarTasks: [exactMatch],
      };
    }

    if (similarTasks.length > 0 && !options?.force) {
      // P1-4 (ADR 0002): kein Hinweis auf --force hier -- ein Ablehnungstext,
      // der seinen eigenen Umgehungsweg mitliefert, ist keine Ablehnung.
      const titles = similarTasks.map((t) => `[${t.id.slice(0, 8)}] "${t.title}"`).join(", ");
      return {
        task: null,
        rejected: true,
        rejectionReason: `Aehnliche Tasks gefunden: ${titles}.`,
        similarTasks,
      };
    }

    const task = this.addTask(input);
    return { task, rejected: false, rejectionReason: null, similarTasks };
  }

  // Task per ID holen (exakt oder Prefix)
  getTask(id: string): Task | null {
    let row = this.db
      .query("SELECT * FROM tasks WHERE id = ?")
      .get(id) as TaskRow | null;

    if (!row) {
      row = this.db
        .query("SELECT * FROM tasks WHERE id LIKE ? LIMIT 1")
        .get(`${id}%`) as TaskRow | null;
    }

    if (!row) return null;
    const task = rowToTask(row);
    task.notes = this.notesService.load(task.id);
    task.hasNotes = task.notes !== null;
    task.isBlocked = this.isBlocked(task.id);
    task.isOverdue = this.isOverdue(task);
    return task;
  }

  // Tasks auflisten mit optionalen Filtern
  listTasks(filter?: ListTasksFilter): Task[] {
    const conditions: string[] = [];
    const params: SQLQueryBindings[] = [];

    if (!filter?.includeArchived) {
      conditions.push("archived = 0");
    }
    if (filter?.columnId) {
      conditions.push("column_id = ?");
      params.push(filter.columnId);
    }
    if (filter?.createdBy) {
      conditions.push("created_by = ?");
      params.push(filter.createdBy);
    }
    if (filter?.assignedTo) {
      conditions.push("assigned_to = ?");
      params.push(filter.assignedTo);
    }
    if (filter?.priority) {
      conditions.push("priority = ?");
      params.push(filter.priority);
    }

    const where = conditions.length > 0
      ? `WHERE ${conditions.join(" AND ")}`
      : "";

    const rows = this.db
      .query(`SELECT * FROM tasks ${where} ${this.buildOrderBy(filter?.sort)}`)
      .all(...params) as TaskRow[];

    const tasks = rows.map((row) => {
      const task = rowToTask(row);
      task.hasNotes = this.notesService.exists(task.id);
      task.isBlocked = this.isBlocked(task.id);
      task.isOverdue = this.isOverdue(task);
      return task;
    });

    // 'overdue' kann nicht rein in SQL ausgedrueckt werden -- ob eine Spalte
    // terminal ist, steht in config.json, nicht in der DB. Deshalb Filterung
    // in JS, nachdem isOverdue je Task schon berechnet ist (s.o.).
    return filter?.overdue ? tasks.filter((t) => t.isOverdue) : tasks;
  }

  // Sortier-Klausel fuer listTasks(). Default bleibt position/created_at --
  // die manuelle Reihenfolge (reorderTask, TUI) darf ohne explizites
  // sort-Flag nicht zerrissen werden. Tasks ohne Prioritaet bzw. ohne
  // Faelligkeit sortieren ans ENDE (CASE-Praefix 3 bzw. 1), nicht als
  // "medium"/"heute faellig" -- null heisst "nicht gesetzt".
  private buildOrderBy(sort: ListTasksFilter["sort"]): string {
    if (sort === "priority") {
      return "ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END, position ASC, created_at ASC";
    }
    if (sort === "due") {
      return "ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date ASC, position ASC, created_at ASC";
    }
    return "ORDER BY position ASC, created_at ASC";
  }

  // Task in andere Spalte verschieben (P1-2). opts.override umgeht Kettenregel
  // UND WIP-Limit UND die Dependency-Regel vollstaendig -- nur fuer den
  // TUI-Bestaetigungsdialog (ADR 0002), markiert die Transition mit
  // was_override = 1. opts.wipPolicy: "log" laesst NUR einen WIP-Verstoss
  // durch (ebenfalls als Override protokolliert, reason "wip-exceeded
  // (sync)") -- die Kettenregel bleibt dabei hart. Fuer den kommenden Sync
  // (P1-7), der TodoWrite nicht ablehnen kann, weil der Hook erst laeuft,
  // nachdem der Agent den Zustand schon gesetzt hat.
  moveTask(id: string, columnId: string, opts?: MoveTaskOptions): Task {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task '${id}' nicht gefunden`);

    const column = this.boardService.getColumn(columnId);
    if (!column) throw new Error(`Spalte '${columnId}' existiert nicht`);

    const wipPolicy = opts?.wipPolicy ?? "reject";
    let wasOverride = opts?.override ?? false;
    let reason = opts?.reason ?? null;

    if (!opts?.override) {
      const check = this.transitionService.canMove(task, columnId);
      if (!check.allowed) {
        if (check.violation === "wip" && wipPolicy === "log") {
          wasOverride = true;
          reason = reason ?? "wip-exceeded (sync)";
        } else {
          throw new Error(check.reason);
        }
      }

      const blockCheck = this.canMoveWhileBlocked(task, column);
      if (!blockCheck.allowed) {
        throw new Error(blockCheck.reason);
      }
    }

    return this.applyMove(task, columnId, {
      reportedBy: opts?.reportedBy ?? "user",
      reason,
      wasOverride,
    });
  }

  // Spaltenwechsel ausfuehren + Transition protokollieren -- geteilt zwischen
  // moveTask (prueft vorher canMove/canMoveWhileBlocked) und completeTask
  // (prueft vorher canComplete/canMoveWhileBlocked). completeTask ruft NICHT
  // das oeffentliche moveTask() auf, sonst wuerde canMove ein zweites Mal
  // pruefen -- mit einer fuer completeTask falschen Frage (WIP der
  // Terminal-Spalte statt "steht der Task vor Terminal").
  private applyMove(
    task: Task,
    columnId: string,
    log: { reportedBy: string; reason: string | null; wasOverride: boolean },
  ): Task {
    const maxPos = this.db
      .query("SELECT COALESCE(MAX(position), -1) as max_pos FROM tasks WHERE column_id = ? AND archived = 0")
      .get(columnId) as { max_pos: number };
    const newPosition = maxPos.max_pos + 1;

    const now = new Date().toISOString();
    this.db.run(
      "UPDATE tasks SET column_id = ?, position = ?, updated_at = ?, version = version + 1 WHERE id = ?",
      [columnId, newPosition, now, task.id],
    );

    this.transitionService.log(task.id, task.columnId, columnId, log.reportedBy, log.reason, log.wasOverride);

    return this.getTask(task.id)!;
  }

  // Dependency-Regel (P1-2, Teamlead-Vorgabe): ein blockierter Task darf
  // geplant, aber nicht bearbeitet werden. Solange isBlocked gilt, wird ein
  // Vorwaerts-Move in eine Spalte mit allowEntry: false abgelehnt. Rueckwaerts
  // bleibt immer erlaubt, ebenso Moves zwischen Eintrittsspalten -- an
  // 'allowEntry' festgemacht statt an einem Spaltennamen, damit die Regel wie
  // die Kettenregel aus config.json ableitbar bleibt statt hartkodiert zu
  // sein. Lebt hier (nicht in TransitionService), weil TransitionService
  // bewusst nichts von Dependencies weiss -- siehe P1-1.
  //
  // Bewusst public (P1-7): sync-service.ts nutzt dieselbe Pruefung, um einen
  // Reconcile-Schritt VOR dem eigentlichen moveTask()-Aufruf zu erkennen und
  // zu ueberspringen, statt die Ausnahme hochkommen zu lassen (eine offene
  // Abhaengigkeit ist ein andauernder Zustand, kein einmaliges Ereignis wie
  // ein WIP-Verstoss -- dieselbe Regel doppelt zu implementieren waere ein
  // Drift-Risiko).
  canMoveWhileBlocked(task: Task, targetColumn: Column): TransitionCheck {
    if (!task.isBlocked) return { allowed: true };

    const columns = this.boardService.getColumns();
    const sourceIndex = columns.findIndex((c) => c.id === task.columnId);
    const targetIndex = columns.findIndex((c) => c.id === targetColumn.id);
    const isForward = sourceIndex !== -1 && targetIndex > sourceIndex;

    if (!isForward || targetColumn.allowEntry) {
      return { allowed: true };
    }

    const terminal = this.boardService.getTerminalColumn();
    const openDeps = this.getDependencies(task.id).filter(
      (d) => !d.archived && d.columnId !== terminal?.id,
    );
    const lines = openDeps.map((d) => {
      const col = this.boardService.getColumn(d.columnId);
      return `  [${d.id.slice(0, 8)}] "${d.title}"   ${col?.name ?? d.columnId}`;
    });

    return {
      allowed: false,
      reason:
        `Verschieben abgelehnt: "${task.title}" wartet auf ${openDeps.length} offene ` +
        `${openDeps.length === 1 ? "Abhaengigkeit" : "Abhaengigkeiten"}.\n\n` +
        `${lines.join("\n")}\n\n` +
        `Erledige diese zuerst, oder loese die Abhaengigkeit mit\n` +
        `kanban_remove_dependency.`,
    };
  }

  // Task innerhalb der Spalte verschieben (hoch/runter)
  reorderTask(id: string, direction: "up" | "down"): Task {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task '${id}' nicht gefunden`);

    // Nachbar-Task in der gewuenschten Richtung finden
    const operator = direction === "up" ? "<" : ">";
    const order = direction === "up" ? "DESC" : "ASC";
    const neighbor = this.db
      .query(`SELECT * FROM tasks WHERE column_id = ? AND archived = 0 AND position ${operator} ? ORDER BY position ${order} LIMIT 1`)
      .get(task.columnId, task.position) as TaskRow | null;

    if (!neighbor) return task; // Kein Nachbar, nichts zu tun

    // Positionen tauschen
    const now = new Date().toISOString();
    this.db.run("UPDATE tasks SET position = ?, updated_at = ? WHERE id = ?", [neighbor.position, now, task.id]);
    this.db.run("UPDATE tasks SET position = ?, updated_at = ? WHERE id = ?", [task.position, now, neighbor.id]);

    return this.getTask(task.id)!;
  }

  // Task Eigenschaften aendern
  updateTask(id: string, changes: UpdateTaskInput): Task {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task '${id}' nicht gefunden`);

    // P2-1: Validierung lebt im Service (siehe addTask). undefined = Feld
    // unberuehrt lassen, null = explizit zuruecksetzen -- beides ueberspringt
    // die Pruefung, nur ein tatsaechlicher Wert wird geprueft.
    assertValidTaskPriority(changes.priority);
    assertValidDueDate(changes.dueDate);

    const updates: string[] = [];
    const params: SQLQueryBindings[] = [];

    if (changes.title !== undefined) { updates.push("title = ?"); params.push(changes.title); }
    if (changes.description !== undefined) { updates.push("description = ?"); params.push(changes.description); }
    if (changes.assignedTo !== undefined) { updates.push("assigned_to = ?"); params.push(changes.assignedTo); }
    if (changes.labels !== undefined) { updates.push("labels = ?"); params.push(JSON.stringify(changes.labels)); }
    if (changes.priority !== undefined) { updates.push("priority = ?"); params.push(changes.priority); }
    if (changes.dueDate !== undefined) { updates.push("due_date = ?"); params.push(changes.dueDate); }

    // Notes separat behandeln (Dateisystem, nicht DB)
    if (changes.notes !== undefined) {
      if (changes.notes === null) {
        this.notesService.delete(task.id);
      } else {
        this.notesService.save(task.id, changes.notes);
      }
    }

    if (updates.length === 0) return this.getTask(task.id)!;

    const now = new Date().toISOString();
    updates.push("updated_at = ?"); params.push(now);
    updates.push("version = version + 1");
    params.push(task.id);

    this.db.run(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`, params);
    return this.getTask(task.id)!;
  }

  // Task loeschen
  deleteTask(id: string): boolean {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task '${id}' nicht gefunden`);
    this.db.run("DELETE FROM tasks WHERE id = ?", [task.id]);
    this.notesService.delete(task.id);
    return true;
  }

  // Task als erledigt markieren (P1-2). Prueft canComplete (Position: direkt
  // vor der Terminal-Spalte) und die Dependency-Regel, bewegt dann direkt
  // ueber applyMove -- NICHT ueber das oeffentliche moveTask(), das wuerde
  // canMove ein zweites Mal pruefen (siehe applyMove-Kommentar).
  // opts.reportedBy optional (P1-3), Default "user" -- fuer CLI/TUI/Skripte,
  // die es weglassen; die MCP-Werkzeugoberflaeche macht es zum Pflichtfeld.
  completeTask(id: string, opts?: { reportedBy?: string }): Task {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task '${id}' nicht gefunden`);

    const terminal = this.boardService.getTerminalColumn();
    if (!terminal) throw new Error("Keine Terminal-Spalte konfiguriert");

    const check = this.transitionService.canComplete(task);
    if (!check.allowed) {
      throw new Error(check.reason);
    }

    const blockCheck = this.canMoveWhileBlocked(task, terminal);
    if (!blockCheck.allowed) {
      throw new Error(blockCheck.reason);
    }

    return this.applyMove(task, terminal.id, {
      reportedBy: opts?.reportedBy ?? "user",
      reason: null,
      wasOverride: false,
    });
  }

  // Pruefen ob ein Task ueberfaellig ist: dueDate < heute && !archived &&
  // Spalte ist nicht terminal (P2-1, Plan Abschnitt 4.4). Ein erledigter Task
  // ist nicht ueberfaellig, auch wenn seine Faelligkeit in der Vergangenheit
  // liegt. Vergleich auf DATUMS-, nicht Zeitstempelebene -- ein heute
  // faelliger Task ist heute nicht ueberfaellig (dueDate < heute ist bei
  // Gleichheit false). 'today' optional und ISO YYYY-MM-DD (Default: echtes
  // heutiges Datum in LOKALER Zeit, nicht UTC -- sonst waere ein Task kurz
  // nach Mitternacht UTC faelschlich schon "morgen" faellig) -- als Parameter
  // ueberschreibbar fuer deterministische Tests, die nicht an Mitternacht
  // flackern duerfen.
  isOverdue(task: Task, today: string = todayLocalIso()): boolean {
    if (!task.dueDate || task.archived) return false;
    const column = this.boardService.getColumn(task.columnId);
    if (column?.isTerminal) return false;
    return task.dueDate < today;
  }

  // Board-Status.
  //
  // `total` zaehlt Waisen mit -- Tasks, deren Spalte in config.json fehlt.
  // Ohne sie waere die Summe kleiner als die Zahl der tatsaechlich
  // vorhandenen Tasks, und CLI und MCP wuerden verschiedene Zahlen zeigen.
  // `orphanCount` steht separat, damit Aufrufer sie kenntlich machen koennen.
  getStatus(): {
    columns: Array<{ column: string; columnId: string; count: number }>;
    total: number;
    orphanCount: number;
  } {
    const columns = this.boardService.getColumns();
    const result = columns.map((col) => ({
      column: col.name,
      columnId: col.id,
      count: this.boardService.getColumnTaskCount(col.id),
    }));
    const known = new Set(columns.map((c) => c.id));
    const orphanCount = this.listTasks().filter((t) => !known.has(t.columnId)).length;
    const total = result.reduce((sum, c) => sum + c.count, 0) + orphanCount;
    return { columns: result, total, orphanCount };
  }
}
