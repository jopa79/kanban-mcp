// Tastatur-Kaskade der TUI als eigener Hook.
//
// Grund: P1-5 (Override-Dialog) hat app.tsx ueber die im Kanban-Task
// (T5oX9WkFXTPq, Teil 3) benannte 420-Zeilen-Stoppgrenze getrieben. Die
// Notes benennen den Ausweg explizit: "Kandidat waere ein use-input-modes.ts,
// das die useInput-Kaskade ... aus der Komponente holt." Genau das passiert
// hier -- eine reine Verhaltens-Verschiebung (Copy+Parametrisierung), kein
// Umbau der State-Owner-Struktur: app.tsx behaelt seinen useState-Zoo, dieser
// Hook bekommt die aktuellen Werte + Setter hereingereicht. Ein tieferer
// Umbau (State-Besitz in den Hook verlagern) waere ein groesserer Schnitt mit
// mehr Regressionsrisiko, als fuer diesen Task noetig -- siehe Bericht an
// team-lead.
import { useInput } from "ink";
import type { Task } from "../core/types.ts";
import { isOrphanTask, type ActionResult, type useBoard } from "./use-board.ts";
import { importBoard } from "../core/export-service.ts";

export type Mode =
  | "board" | "detail" | "add" | "filter" | "confirm-delete" | "help"
  | "edit-notes" | "edit-tags" | "edit-title" | "edit-description"
  | "archive" | "edit-deps" | "export-path" | "import-path"
  | "import-confirm" | "confirm-override" | "edit-priority" | "board-picker";

// Ausstehender Override: Ablehnungsgrund (voller Text aus TransitionService,
// ADR 0002) + die Aktion, die bei 'y' mit override:true wiederholt wird.
export interface PendingOverride {
  reason: string;
  retry: () => void;
}

type Board = ReturnType<typeof useBoard>;

export interface UseInputModesArgs {
  workingDir: string;
  exit: () => void;
  board: Board;
  mode: Mode;
  selectedCol: number;
  selectedRow: number;
  moving: boolean;
  detailTask: Task | null;
  importPath: string;
  pendingOverride: PendingOverride | null;
  selectedTask: Task | null;
  // P2-3: reiner Ansichtsmodus (sortiert nach Prioritaet, schreibt nie
  // 'position'). Toggle lebt hier wie alle anderen Board-Modus-Tasten.
  sortByPriority: boolean;
  // Nur die Laenge wird gebraucht (Grenzen fuer Pfeiltasten hoch/runter) --
  // das volle Array muesste sonst unnoetig durchgereicht werden.
  currentColTaskCount: number;
  setMode: (mode: Mode) => void;
  setStatusMsg: (msg: string) => void;
  setSelectedCol: (col: number) => void;
  setSelectedRow: (row: number) => void;
  setMoving: (moving: boolean) => void;
  setFilterText: (text: string) => void;
  setDetailTask: (task: Task | null) => void;
  setPendingOverride: (pending: PendingOverride | null) => void;
  setArchivedTasks: (tasks: Task[]) => void;
  setSortByPriority: (value: boolean) => void;
}

// Registriert die komplette Tastatur-Kaskade der Board-Ansicht ueber Inks
// useInput(). Reiner Seiteneffekt-Hook -- kein Rueckgabewert, alle
// Zustandsaenderungen laufen ueber die hereingereichten Setter.
export function useInputModes(args: UseInputModesArgs): void {
  const {
    workingDir, exit, board, mode, selectedCol, selectedRow, moving,
    detailTask, importPath, pendingOverride, selectedTask, currentColTaskCount,
    sortByPriority,
    setMode, setStatusMsg, setSelectedCol, setSelectedRow, setMoving,
    setFilterText, setDetailTask, setPendingOverride, setArchivedTasks,
    setSortByPriority,
  } = args;

  // Fuehrt eine Aktion aus, die von der Zustandsmaschine abgelehnt werden kann
  // (moveTask/completeTask liefern {ok,reason} statt zu werfen, siehe
  // use-board.ts). Bei Ablehnung zeigt der Dialog den VOLLEN Text aus
  // TransitionService (ADR 0002) -- erst danach bietet er den Override an.
  // 'y' im Dialog fuehrt dieselbe Aktion mit override:true erneut aus, kein
  // zweiter Weg.
  const attemptWithOverride = (run: (override: boolean) => ActionResult, onSuccess: () => void) => {
    const result = run(false);
    if (result.ok) { onSuccess(); return; }
    setPendingOverride({
      reason: result.reason ?? "Aktion abgelehnt.",
      retry: () => {
        const retried = run(true);
        if (retried.ok) onSuccess();
        else setStatusMsg(retried.reason ?? "Aktion fehlgeschlagen.");
      },
    });
    setMode("confirm-override");
  };

  useInput((input, key) => {
    // Esc in Export/Import-Pfadeingabe: LineInput ruft dafuer selbst
    // onCancel auf (app.tsx: handleExportCancel/handleImportCancel) -- kein
    // zweiter Handler noetig (#50, Plan Schritt 2).

    // Import-Bestaetigungsdialog
    if (mode === "import-confirm") {
      if (input === "y") {
        setMode("board"); setStatusMsg("Importiere...");
        importBoard(workingDir, importPath, { force: true }).then(() => {
          board.refresh(); setStatusMsg("Board importiert");
        }).catch((err: Error) => { setStatusMsg(`Import-Fehler: ${err.message}`); });
      } else if (input === "n" || key.escape) {
        setMode("board"); setStatusMsg("Import abgebrochen");
      }
      return;
    }

    // Override-Bestaetigung (P1-5, ADR 0002): der volle Ablehnungstext steht
    // laengst im StatusBar-Footer (OverrideConfirm) -- hier nur noch die
    // Entscheidung. 'y' wiederholt die Aktion mit override:true.
    if (mode === "confirm-override") {
      if (input === "y") {
        const pending = pendingOverride;
        setMode("board"); setPendingOverride(null);
        pending?.retry();
      } else if (input === "n" || key.escape) {
        setMode("board"); setPendingOverride(null); setStatusMsg("Abgebrochen");
      }
      return;
    }

    // Texteingabe-Modi: kein Key-Handling hier (Komponenten handeln selbst)
    if (mode === "add" || mode === "filter" || mode === "edit-notes" || mode === "edit-tags" || mode === "edit-title" || mode === "edit-description" || mode === "edit-deps" || mode === "export-path" || mode === "import-path" || mode === "edit-priority") return;

    if (mode === "detail") {
      if (input === "q" || key.escape) { setMode("board"); setDetailTask(null); setStatusMsg(""); }
      if (input === "e" && detailTask) {
        setMode("edit-notes");
      }
      if (input === "t" && detailTask) {
        setMode("edit-tags");
      }
      if (input === "T" && detailTask) {
        setMode("edit-title");
      }
      if (input === "b" && detailTask) {
        setMode("edit-description");
      }
      if (input === "p" && detailTask) {
        setMode("edit-priority");
      }
      if (input === "D" && detailTask) {
        setMode("edit-deps");
      }
      return;
    }
    if (mode === "help") {
      if (input === "q" || key.escape || input === "?") { setMode("board"); }
      return;
    }
    if (mode === "confirm-delete") {
      if (input === "y" && selectedTask) {
        board.deleteTask(selectedTask.id);
        setStatusMsg(`"${selectedTask.title}" geloescht`);
        setSelectedRow(Math.max(0, selectedRow - 1));
      }
      setMode("board");
      return;
    }

    // Board-Modus
    if (input === "q") { exit(); return; }

    // Space = Verschiebe-Modus togglen
    if (input === " " && selectedTask) { setMoving(!moving); setStatusMsg(moving ? "" : "VERSCHIEBEN"); return; }
    if (key.escape) { if (moving) { setMoving(false); setStatusMsg(""); } else { setFilterText(""); setStatusMsg("Filter aufgehoben"); } return; }

    if (moving && selectedTask) {
      // Verschiebe-Modus: Pfeiltasten bewegen den Task. Eine Waisen-Quelle
      // (P1-6) bekommt reason: "orphan-recovery" mitgeloggt -- die
      // Zustandsmaschine erlaubt jeden Move aus der Sammelspalte heraus
      // strukturell (siehe transition-service.ts), abgelehnt wird hier also
      // praktisch nur bei einer echten Quellspalte.
      const taskId = selectedTask.id;
      const moveReason = isOrphanTask(selectedTask, board.columns) ? "orphan-recovery" : undefined;
      if (key.leftArrow && selectedCol > 0) {
        const target = board.displayColumns[selectedCol - 1]!;
        const destCol = selectedCol - 1;
        attemptWithOverride(
          (override) => board.moveTask(taskId, target.id, { override, reason: moveReason }),
          () => { setSelectedCol(destCol); setSelectedRow(0); setStatusMsg(`VERSCHIEBEN -> ${target.name}`); },
        );
      }
      if (key.rightArrow && selectedCol < board.displayColumns.length - 1) {
        const target = board.displayColumns[selectedCol + 1]!;
        const destCol = selectedCol + 1;
        attemptWithOverride(
          (override) => board.moveTask(taskId, target.id, { override, reason: moveReason }),
          () => { setSelectedCol(destCol); setSelectedRow(0); setStatusMsg(`VERSCHIEBEN -> ${target.name}`); },
        );
      }
      if (key.upArrow) { board.reorderTask(selectedTask.id, "up"); setSelectedRow(Math.max(0, selectedRow - 1)); setStatusMsg("VERSCHIEBEN ↑"); }
      if (key.downArrow) { board.reorderTask(selectedTask.id, "down"); setSelectedRow(Math.min(currentColTaskCount - 1, selectedRow + 1)); setStatusMsg("VERSCHIEBEN ↓"); }
      return;
    }

    // Navigations-Modus: Pfeiltasten bewegen den Cursor
    if (key.leftArrow) { setSelectedCol(Math.max(0, selectedCol - 1)); setSelectedRow(0); setStatusMsg(""); }
    if (key.rightArrow) { setSelectedCol(Math.min(board.displayColumns.length - 1, selectedCol + 1)); setSelectedRow(0); setStatusMsg(""); }
    if (key.upArrow) { setSelectedRow(Math.max(0, selectedRow - 1)); setStatusMsg(""); }
    if (key.downArrow) { setSelectedRow(Math.min(currentColTaskCount - 1, selectedRow + 1)); setStatusMsg(""); }
    if (key.return && selectedTask) {
      const full = board.getTask(selectedTask.id);
      setDetailTask(full);
      setMode("detail");
    }
    // 't' (Backlog -> Todo) ist strukturell immer legal (ein Schritt vorwaerts,
    // Todo hat kein WIP-Limit) -- kein Override-Dialog (Plan Abschnitt 3.6).
    // Der Ablehnungsgrund wird trotzdem angezeigt statt verschluckt, falls ein
    // individuell angepasstes Board (WIP-Limit auf Todo) doch mal ablehnt.
    if (input === "t" && selectedTask && selectedTask.columnId === "backlog") {
      const result = board.moveTask(selectedTask.id, "todo");
      setStatusMsg(result.ok ? `"${selectedTask.title}" -> Todo` : (result.reason ?? "Verschieben fehlgeschlagen"));
    }
    if (input === "d" && selectedTask) {
      const taskId = selectedTask.id;
      attemptWithOverride(
        (override) => board.completeTask(taskId, { override }),
        () => setStatusMsg("-> Done"),
      );
    }
    if (input === "n") { setMode("add"); }
    if (input === "x" && selectedTask) { setMode("confirm-delete"); }
    if (input === "a" && selectedTask) { board.archiveTask(selectedTask.id); setStatusMsg(`"${selectedTask.title}" archiviert`); setSelectedRow(Math.max(0, selectedRow - 1)); }
    if (input === "/") { setMode("filter"); }
    if (input === "r") { board.refresh(); setStatusMsg("Aktualisiert"); }
    // P2-3: reiner Ansichtsmodus, toggelt nur die Anzeige-Sortierung -- der
    // eigentliche Verzicht auf Sortierung waehrend des Verschiebens passiert
    // NICHT hier (dieser Zweig ist im Verschiebe-Modus ohnehin unerreichbar,
    // siehe 'if (moving && selectedTask)' oben), sondern verbindlich in
    // resolveEffectiveSort() (use-board.ts), das 'moving' direkt prueft.
    if (input === "s") {
      const next = !sortByPriority;
      setSortByPriority(next);
      setStatusMsg(next ? "Sortiert nach Prioritaet" : "Standard-Sortierung");
    }
    if (input === "?") { setMode("help"); }
    if (input === "A") { setArchivedTasks(board.listArchived()); setMode("archive"); }
    // Export-Vorbelegung (Datum im Dateinamen) wird jetzt beim Rendern von
    // ExportInput in app.tsx berechnet, nicht mehr hier -- LineInput nimmt
    // seine Vorbelegung nur beim eigenen Mount an (#50, Plan Schritt 2).
    if (input === "E") { setMode("export-path"); }
    if (input === "I") { setMode("import-path"); }
    // P3-3: Board-Auswahl oeffnen. Die Auswahl selbst (Registry laden, Guard
    // fuer Schema v2/fehlende Pfade) lebt in board-picker.tsx -- hier nur der
    // Moduswechsel, wie bei 'A'/'E'/'I' auch.
    if (input === "B") { setMode("board-picker"); }
  });
}
