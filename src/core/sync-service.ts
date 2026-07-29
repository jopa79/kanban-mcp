// Sync-Logik fuer TodoWrite (P1-7): gleicht eine TodoWrite-Liste mit dem
// Board ab. Eigene Datei (nicht in sync.ts) -- die CLI-Huelle bleibt so
// unter 300 Zeilen, und diese Logik ist ohne simuliertes stdin testbar.
// Siehe Plan Abschnitt 0.1 (Payload-Befund) und 3.9 (Sync-Umbau).
import type { Database } from "bun:sqlite";
import type { BoardService } from "./board-service.ts";
import type { TaskService } from "./task-service.ts";
import type { Task } from "./types.ts";
import { TransitionService } from "./transition-service.ts";

// Der echte TodoWrite-Hook-Payload hat pro Todo GENAU diese drei Felder
// (Plan Abschnitt 0.1, belegt aus drei unabhaengigen Quellen: installiertes
// CLI-Binary 2.1.220, ein RE-Repo fuer 2.1.84, ein unabhaengiger Gist).
// 'id' und 'priority' existieren NICHT -- eine frueher hier deklarierte
// Fassung war eine sehr fruehe, nie validierte Version. 'activeForm' existiert
// im Payload, wird hier aber bewusst nicht verwendet: 'content' traegt die
// fuer das Board relevante Information. Steht trotzdem im Interface, damit
// klar ist, dass das Feld bekannt und absichtlich ungenutzt ist -- sonst
// fragt in einem halben Jahr jemand, ob es uebersehen wurde.
export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

// Bekannte TodoWrite-Status -> Kanban-Spalte. Kein 'cancelled' mehr: der Wert
// existiert im echten Payload nicht (siehe TodoItem-Kommentar), der fruehere
// Zweig war toter Code. Ein unbekannter/kuenftiger status-Wert faellt auf
// DEFAULT_COLUMN zurueck statt abzustuerzen.
const STATUS_TO_COLUMN: Record<string, string> = {
  pending: "todo",
  in_progress: "in-progress",
  completed: "done",
};
const DEFAULT_COLUMN = "todo";

// Tasks werden mit maximal so vielen Zeichen angelegt (bestehende Konvention,
// siehe addTask-Aufrufer) -- auch fuer den Titel-Abgleich gegen bereits
// gekuerzt angelegte Tasks relevant.
export const TITLE_TRUNCATE_LENGTH = 200;

export interface SyncReport {
  created: number;
  moved: number;
  skipped: number;
  // WIP-Verstoesse, die durchgewunken (nicht abgelehnt) und protokolliert
  // wurden -- TodoWrite ist nicht ablehnbar, siehe reconcileTask().
  wipOverrides: number;
}

// Kuerzt einen Titel auf maxLen Zeichen (mit "..."-Suffix) -- exportiert,
// damit Tests dieselbe Logik nutzen koennen wie das Titel-Matching selbst,
// statt sie zu duplizieren.
export function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

// Gleicht eine TodoWrite-Liste mit dem Board ab: legt neue Tasks an, bewegt
// bestehende per Reconcile-Pfad an ihre Zielspalte, protokolliert jeden
// Schritt. Die gesamte Schleife laeuft in EINER Transaktion (Plan 3.9c) --
// bricht ein Schritt mit einem echten Fehler ab (z.B. die Dependency-Regel
// aus P1-2, ein blockierter Task darf nicht vorwaerts in eine Arbeitsspalte),
// wird NICHTS geschrieben. Nur WIP-Verstoesse sind bewusst ausgenommen
// (werden geloggt, nicht abgelehnt) -- TodoWrite selbst kann nicht abgelehnt
// werden, der Hook laeuft erst NACHDEM der Agent den Zustand gesetzt hat.
export function syncTodos(
  db: Database,
  taskService: TaskService,
  boardService: BoardService,
  todos: TodoItem[],
): SyncReport {
  const transitionService = new TransitionService(db, boardService);
  const run = db.transaction(() => runSync(taskService, transitionService, todos));
  return run();
}

function runSync(
  taskService: TaskService,
  transitionService: TransitionService,
  todos: TodoItem[],
): SyncReport {
  // Einmaliger Schnappschuss zu Laufbeginn -- neu angelegte Tasks aus diesem
  // Lauf sollen von SPAETEREN Todos im selben Payload nicht mehr getroffen
  // werden koennen (die stehen ohnehin nicht in diesem Snapshot).
  const existingTasks = taskService.listTasks();
  const matchedIds = new Set<string>();

  const report: SyncReport = { created: 0, moved: 0, skipped: 0, wipOverrides: 0 };

  for (const todo of todos) {
    const targetColumn = STATUS_TO_COLUMN[todo.status] ?? DEFAULT_COLUMN;
    const match = findMatch(existingTasks, todo.content, matchedIds);

    if (match) {
      matchedIds.add(match.id);
      if (match.columnId === targetColumn) {
        report.skipped++;
        continue;
      }
      report.wipOverrides += reconcileTask(taskService, transitionService, match.id, match.columnId, targetColumn);
      report.moved++;
    } else {
      const created = taskService.addTask({
        title: truncate(todo.content, TITLE_TRUNCATE_LENGTH),
        createdBy: "claude",
        reportedBy: "sync",
      });
      matchedIds.add(created.id);
      report.wipOverrides += reconcileTask(taskService, transitionService, created.id, created.columnId, targetColumn);
      report.created++;
    }
  }

  return report;
}

// Content-Matching, gehaertet (Plan 3.9b): einzige moegliche Strategie, da
// 'id' im Payload nicht existiert (source_id ist gestrichen, Plan 0.1). Bei
// mehreren Treffern gewinnt der AELTESTE nicht archivierte Task, NICHT der
// erste in Listenreihenfolge (die haengt an 'position', die sich bei jedem
// Verschieben aendert -- derselbe Sync traefe sonst je nach Board-Zustand
// einen anderen Task). Ein bereits in diesem Lauf getroffener Task matcht
// nicht erneut, sonst kollabieren zwei gleichnamige Todos auf einen Task.
function findMatch(tasks: Task[], content: string, alreadyMatched: Set<string>): Task | null {
  const truncated = truncate(content, TITLE_TRUNCATE_LENGTH);
  const candidates = tasks.filter(
    (t) =>
      !t.archived &&
      !alreadyMatched.has(t.id) &&
      (t.title === content || t.title === truncated),
  );
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return candidates[0]!;
}

// Bewegt einen Task von seiner aktuellen Spalte zur Zielspalte ueber
// reconcilePath() -- jeder Zwischenschritt eine eigene, protokollierte
// Transition mit reportedBy: "sync", reason: "reconcile". Liefert die Anzahl
// der dabei durchgewunkenen WIP-Verstoesse (Plan 3.9e).
//
// Bewusst reconcilePath() statt canMove()/completeTask(): der Sync meldet
// einen ZIELZUSTAND, keinen Uebergang -- TodoWrite kann nicht ablehnen, weil
// der Hook laeuft, nachdem der Agent den Zustand bereits gesetzt hat.
// reconcilePath() ist ausschliesslich fuer diesen Zweck gedacht (siehe
// TransitionService); wuerde sie anderswo verwendet, liefe jeder normale
// Move automatisch durch die Kette durch und diese waere Dekoration.
//
// Ein frisch als "completed" auftauchender Todo erzeugt so vier Transitions
// (Entstehung + drei Reconcile-Schritte) mit Zeitstempeln in derselben
// Sekunde -- die Kette wird durchlaufen, nicht uebersprungen. Bewusster Preis
// fuer die Kettenintegritaet; reason: "reconcile" macht die Schritte
// filterbar, falls das je "wegoptimiert" werden soll: nicht tun, die
// Kettenintegritaet ist der Punkt.
function reconcileTask(
  taskService: TaskService,
  transitionService: TransitionService,
  taskId: string,
  fromColumnId: string,
  toColumnId: string,
): number {
  const path = transitionService.reconcilePath(fromColumnId, toColumnId);
  let wipOverrides = 0;

  for (const stepColumnId of path) {
    // Vorabpruefung (kein Schreibzugriff): zaehlt WIP-Verstoesse fuer den
    // Bericht UND entscheidet, welchen reason-Wert dieser Schritt bekommt.
    // Wichtig: TaskService.moveTask() uebernimmt einen explizit uebergebenen
    // reason unveraendert (reason ?? "wip-exceeded (sync)") -- ein hier fest
    // gesetztes reason: "reconcile" wuerde also den WIP-Marker verdecken.
    // Deshalb reason nur setzen, wenn dieser Schritt KEIN WIP-Verstoss ist;
    // im WIP-Fall bleibt reason weg und moveTask() traegt "wip-exceeded
    // (sync)" selbst ein.
    const currentTask = taskService.getTask(taskId)!;
    const check = transitionService.canMove(currentTask, stepColumnId);
    const isWipViolation = !check.allowed && check.violation === "wip";
    if (isWipViolation) {
      wipOverrides++;
    }

    // wipPolicy: "log" laesst NUR WIP-Verstoesse durch (protokolliert als
    // Override) -- die Kettenregel bleibt hart. reconcilePath() liefert aber
    // ausschliesslich Schritte, die genau einen Index vorwaerts oder einen
    // beliebig weiten Ruecksprung machen, also strukturell immer kettenlegal;
    // die Dependency-Regel (P1-2) bleibt dagegen scharf -- ein Task, der laut
    // TodoWrite fertig sein soll, aber im Board noch blockiert ist, laesst
    // moveTask() hier bewusst werfen (kein wipPolicy-Freifahrtschein dafuer).
    // Das ist ein "Fehler in der Mitte" im Sinne von 3.9c: die gesamte
    // Transaktion rollt zurueck, siehe syncTodos().
    taskService.moveTask(taskId, stepColumnId, {
      reportedBy: "sync",
      reason: isWipViolation ? undefined : "reconcile",
      wipPolicy: "log",
    });
  }

  return wipOverrides;
}
