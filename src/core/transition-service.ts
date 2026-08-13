// Zustandsmaschine fuer Spaltenuebergaenge — Regeln pruefen, Pfade berechnen,
// Transitions protokollieren. Eigene Datei (nicht an task-service.ts angebaut,
// die naehert sich bereits der 400er-Grenze). Siehe Plan Abschnitt 3.1/3.2,
// Kanban-Task P1-1, ADR 0002 (kein `force` in MCP-Tools -> Ablehnungstexte
// muessen handlungsleitend sein, sonst baut sich irgendwer ein Schlupfloch).
import type { Database } from "bun:sqlite";
import type { BoardService } from "./board-service.ts";
import type { Column, Task, TaskRow, Transition, TransitionRow } from "./types.ts";
import { rowToTransition } from "./types.ts";

// Zeiteinheiten fuer die "blockiert seit"-Formatierung in Ablehnungstexten --
// benannt statt als Magic Numbers im Code verstreut.
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const ID_PREFIX_LENGTH = 8;

export interface TransitionCheck {
  allowed: boolean;
  reason?: string; // handlungsleitender Text, nur gesetzt wenn !allowed
  // P1-2: unterscheidet WIP- von Kettenablehnungen (unbekannte Zielspalte
  // zaehlt strukturell zur Kette). TaskService.moveTask braucht das fuer
  // opts.wipPolicy: "log" -- die Kettenregel muss dabei hart bleiben, ein
  // reiner WIP-Verstoss darf durchgewunken (und protokolliert) werden. Nur
  // gesetzt wenn !allowed.
  violation?: "chain" | "wip";
}

// Formatiert eine Zeitspanne seit einem ISO-Zeitstempel als deutschsprachigen
// Text ("4 Tagen", "2 Stunden", "6 Minuten") -- fuer die "Blockiert seit"-Zeile
// in WIP-Ablehnungen (Plan Abschnitt 3.2).
function formatSince(sinceIso: string): string {
  const elapsedMs = Math.max(0, Date.now() - new Date(sinceIso).getTime());
  const minutes = Math.floor(elapsedMs / MS_PER_MINUTE);
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const days = Math.floor(hours / HOURS_PER_DAY);

  if (days >= 1) return `${days} ${days === 1 ? "Tag" : "Tagen"}`;
  if (hours >= 1) return `${hours} ${hours === 1 ? "Stunde" : "Stunden"}`;
  if (minutes >= 1) return `${minutes} ${minutes === 1 ? "Minute" : "Minuten"}`;
  return "unter einer Minute";
}

export class TransitionService {
  constructor(
    private db: Database,
    private boardService: BoardService,
  ) {}

  // Ob 'task' nach 'toColumnId' verschoben werden darf. Die Kettenregel wird
  // aus dem Array-Index in boardService.getColumns() abgeleitet (Reihenfolge
  // aus config.json), NICHT aus einer hartkodierten Uebergangsmatrix -- siehe
  // ADR 0001. zielIndex <= quellIndex + 1 -> erlaubt, sonst abgelehnt.
  // Rueckspruenge beliebiger Weite sind damit automatisch erlaubt.
  canMove(task: Task, toColumnId: string): TransitionCheck {
    if (task.columnId === toColumnId) {
      return { allowed: true }; // no-op, kein Fehler
    }

    const columns = this.boardService.getColumns();
    const sourceIndex = columns.findIndex((c) => c.id === task.columnId);

    // Waisen-Spalte als Quelle (Spalte fehlt in config.json): Position ist
    // unbekannt, die Regel kann nicht ausgewertet werden -> jeder Move ist
    // erlaubt. Der Aufrufer protokolliert das ggf. mit reason "orphan-recovery"
    // (siehe log()) -- das entscheidet TransitionService hier nicht selbst.
    if (sourceIndex === -1) {
      return { allowed: true };
    }

    const targetIndex = columns.findIndex((c) => c.id === toColumnId);
    if (targetIndex === -1) {
      return {
        allowed: false,
        reason:
          `Verschieben abgelehnt: Zielspalte '${toColumnId}' existiert nicht im Board.\n\n` +
          `Gueltige Spalten: ${columns.map((c) => c.id).join(", ")}.`,
        violation: "chain",
      };
    }

    if (targetIndex > sourceIndex + 1) {
      const sourceCol = columns[sourceIndex]!;
      const targetCol = columns[targetIndex]!;
      const nextCol = columns[sourceIndex + 1]!;
      return {
        allowed: false,
        reason:
          `Verschieben abgelehnt: "${task.title}" steht in ${sourceCol.name},\n` +
          `Ziel waere ${targetCol.name}.\n\n` +
          `Die Kette ist vorwaerts strikt: aus ${sourceCol.name} geht es nur nach ${nextCol.name}.\n` +
          `Rueckwaerts ist jeder Sprung erlaubt.\n\n` +
          `Naechster gueltiger Schritt: kanban_move_task(id, "${nextCol.id}")`,
        violation: "chain",
      };
    }

    // Kette erlaubt den Schritt -- jetzt die Kapazitaet der Zielspalte pruefen.
    // wipLimit 0 heisst unbegrenzt (Konvention seit Schema v3, siehe db.ts).
    const targetColumn = columns[targetIndex]!;
    if (targetColumn.wipLimit > 0) {
      const occupants = this.columnOccupants(targetColumn.id);
      if (occupants.length >= targetColumn.wipLimit) {
        return this.wipRejection(targetColumn, occupants, columns[targetIndex + 1]);
      }
    }

    return { allowed: true };
  }

  // Ob in 'columnId' direkt (addTask) ein neuer Task entstehen darf. Erlaubt
  // sind Spalten mit allowEntry: true (Default-Board: backlog, todo) -- 'done'
  // steht bewusst auf false, sonst waere "Abschluss nur aus Review" mit einem
  // addTask({columnId: "done"}) umgangen (Plan Abschnitt 3.4).
  canEnter(columnId: string): TransitionCheck {
    const column = this.boardService.getColumn(columnId);
    if (!column) {
      return {
        allowed: false,
        reason: `Eintritt abgelehnt: Spalte '${columnId}' existiert nicht im Board.`,
      };
    }

    if (!column.allowEntry) {
      const entryColumns = this.boardService
        .getColumns()
        .filter((c) => c.allowEntry)
        .map((c) => c.id)
        .join(", ");
      return {
        allowed: false,
        reason:
          `Eintritt abgelehnt: "${column.name}" ist keine Eintrittsspalte.\n\n` +
          `Neue Tasks koennen nur in folgenden Spalten entstehen: ${entryColumns}.`,
      };
    }

    return { allowed: true };
  }

  // Ob 'task' abgeschlossen (in die Terminal-Spalte verschoben) werden darf.
  // Der Task muss in der Spalte direkt vor der Terminal-Spalte stehen -- welche
  // das ist, wird aus dem Index der Terminal-Spalte abgeleitet (NICHT auf
  // "review" hartkodiert, Plan Abschnitt 3.1/3.5).
  canComplete(task: Task): TransitionCheck {
    const columns = this.boardService.getColumns();
    const terminalIndex = columns.findIndex((c) => c.isTerminal);
    const requiredIndex = terminalIndex - 1;
    const requiredColumn = columns[requiredIndex];
    const taskIndex = columns.findIndex((c) => c.id === task.columnId);

    if (taskIndex === requiredIndex) {
      return { allowed: true };
    }

    const terminalColumn = columns[terminalIndex];
    const currentColumnName = taskIndex === -1 ? task.columnId : columns[taskIndex]!.name;

    return {
      allowed: false,
      reason:
        `Abschluss abgelehnt: "${task.title}" steht in ${currentColumnName}, nicht in ${requiredColumn?.name ?? "?"}.\n\n` +
        `Ein Task geht nach ${requiredColumn?.name ?? "?"}, wird dort geprueft, und erst dann nach ${terminalColumn?.name ?? "?"}.\n` +
        `Naechster Schritt: kanban_move_task(id, "${requiredColumn?.id ?? "?"}")`,
    };
  }

  // Liste der Zwischenspalten von 'fromColumnId' nach 'toColumnId'. Vorwaerts:
  // jede Spalte dazwischen inklusive Ziel. Rueckwaerts (oder unbekannte
  // Quelle): direkter Sprung, ein Element. PRUEFT KEINE Regel -- ausschliesslich
  // fuer den Sync (Plan Abschnitt 3.1/3.9: 'kanban sync' meldet den Zielzustand,
  // nicht den Weg). Wuerde diese Methode anderswo verwendet, liefe jeder
  // 'kanban done' automatisch durch Review durch und die Kette waere Dekoration.
  reconcilePath(fromColumnId: string, toColumnId: string): string[] {
    if (fromColumnId === toColumnId) {
      return [];
    }

    const columns = this.boardService.getColumns();
    const fromIndex = columns.findIndex((c) => c.id === fromColumnId);
    const toIndex = columns.findIndex((c) => c.id === toColumnId);

    if (fromIndex === -1 || toIndex === -1 || toIndex < fromIndex) {
      // Rueckwaerts oder unbekannte Quelle: kein sinnvoller Zwischenschritt
      // berechenbar -- direkter Sprung.
      return [toColumnId];
    }

    return columns.slice(fromIndex + 1, toIndex + 1).map((c) => c.id);
  }

  // Transition protokollieren. Wird sowohl fuer regulaere Uebergaenge als auch
  // fuer die ausgenommenen Operationen verwendet (restoreTask -> reason
  // "restore", Waisen-Spalte -> reason "orphan-recovery", Sync -> reason
  // "reconcile", TUI-Override -> wasOverride true) -- ruft dafuer NICHT selbst
  // canMove/canComplete auf, das entscheidet der Aufrufer (Plan Abschnitt 3.1).
  log(
    taskId: string,
    fromColumn: string | null,
    toColumn: string,
    reportedBy: string,
    reason: string | null,
    wasOverride: boolean,
  ): void {
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO transitions (task_id, from_column, to_column, reported_by, reason, was_override, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [taskId, fromColumn, toColumn, reportedBy, reason, wasOverride ? 1 : 0, now],
    );
  }

  // Gesamtzahl protokollierter Transitions ueber alle Tasks (K-5, ADR 0005).
  // Die Tabelle waechst unbegrenzt: 'archiveTasks' setzt nur ein Flag und
  // loescht nichts, und der Reconcile-Sync erzeugt fuer ein Todo, das erstmals
  // als 'completed' auftaucht, vier Zeilen auf einmal. Nichts kappt das heute.
  // 'kanban status' weist die Zahl deshalb aus -- solange niemand sie sieht,
  // faellt ein Wildwuchs erst auf, wenn die Datei spuerbar gross ist.
  count(): number {
    const row = this.db.query("SELECT COUNT(*) AS n FROM transitions").get() as { n: number };
    return row.n;
  }

  // Vollstaendige Transition-Historie eines Tasks, chronologisch aufsteigend.
  // 'id ASC' als Tie-Breaker, falls zwei Transitions denselben Zeitstempel haben.
  history(taskId: string): Transition[] {
    const rows = this.db
      .query("SELECT * FROM transitions WHERE task_id = ? ORDER BY created_at ASC, id ASC")
      .all(taskId) as TransitionRow[];
    return rows.map(rowToTransition);
  }

  // Aktive (nicht archivierte) Tasks in einer Spalte -- fuer die WIP-Pruefung
  // und die Ablehnungsliste ("Blockiert seit").
  private columnOccupants(columnId: string): TaskRow[] {
    return this.db
      .query("SELECT * FROM tasks WHERE column_id = ? AND archived = 0 ORDER BY position ASC")
      .all(columnId) as TaskRow[];
  }

  // Letzter Eintritt eines Tasks in eine Spalte: aus der Transition-Historie,
  // Fallback tasks.updated_at fuer Tasks ohne Historie (Plan Abschnitt 3.2).
  private lastEnteredAt(taskId: string, columnId: string, fallback: string): string {
    const row = this.db
      .query(
        "SELECT created_at FROM transitions WHERE task_id = ? AND to_column = ? ORDER BY created_at DESC, id DESC LIMIT 1",
      )
      .get(taskId, columnId) as { created_at: string } | null;
    return row?.created_at ?? fallback;
  }

  // Baut den Ablehnungstext fuer eine volle Zielspalte: welche Tasks sie seit
  // wann belegen, und was der Aufrufer stattdessen tun kann (Plan Abschnitt 3.2).
  private wipRejection(targetColumn: Column, occupants: TaskRow[], nextColumn: Column | undefined): TransitionCheck {
    const lines = occupants.map((row) => {
      const since = formatSince(this.lastEnteredAt(row.id, targetColumn.id, row.updated_at));
      const who = row.assigned_to ?? row.created_by;
      return `  [${row.id.slice(0, ID_PREFIX_LENGTH)}] "${row.title}"  seit ${since}  (${who})`;
    });

    const moveHint = nextColumn
      ? `einen dieser Tasks nach ${nextColumn.name} weiterbewegen`
      : `einen dieser Tasks in eine andere Spalte weiterbewegen`;

    return {
      allowed: false,
      reason:
        `Verschieben abgelehnt: ${targetColumn.name} ist voll (${occupants.length} von ${targetColumn.wipLimit}).\n\n` +
        `Blockiert seit:\n${lines.join("\n")}\n\n` +
        `Moeglichkeiten: ${moveHint},\n` +
        `oder das WIP-Limit in .kanban/config.json anheben.`,
      violation: "wip",
    };
  }
}
