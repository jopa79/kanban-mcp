// Ink Root Component — Interaktive Kanban TUI
import React, { useState, useEffect } from "react";
import { Box, Text, useApp, useStdout } from "ink";
import { boardExists } from "../core/db.ts";
import { exportBoard } from "../core/export-service.ts";
import { BoardView } from "./board-view.tsx";
import { DetailView } from "./detail-view.tsx";
import { HelpView } from "./help-view.tsx";
import { AddInput, FilterInput, TitleInput, DescInput, DeleteConfirm, ExportInput, ImportInput, ImportConfirm, OverrideConfirm, StatusBar } from "./status-bar.tsx";
import { TextArea } from "./text-area.tsx";
import { TagPicker } from "./tag-picker.tsx";
import { PriorityPicker } from "./priority-picker.tsx";
import { ArchiveView } from "./archive-view.tsx";
import { DependencyView } from "./dependency-view.tsx";
import { BoardPicker } from "./board-picker.tsx";
import { useBoard, isOrphanTask, resolveEffectiveSort } from "./use-board.ts";
import { useInputModes, type Mode, type PendingOverride } from "./use-input-modes.ts";
import { useDetailHandlers } from "./use-detail-handlers.ts";
import { getColumnColor, ACCENT } from "./theme.ts";
import { ORPHAN_COLUMN_ID } from "../core/types.ts";

interface AppProps {
  workingDir: string;
}

// Startspalte nach Mount und nach Board-Wechsel (Index 1 = "Todo" im
// Standard-Spaltenlayout) -- eigener Name statt einer zweiten magischen 1 an
// zwei Stellen (siehe useState unten und handleBoardSelect).
const INITIAL_SELECTED_COLUMN = 1;

export function App({ workingDir: initialWorkingDir }: AppProps) {
  const { exit } = useApp();
  // P3-3: workingDir ist jetzt Zustand statt durchgereichter Prop -- nur so
  // greift die bestehende Watcher-Cleanup in use-board.ts (useEffect-Deps
  // [workingDir, refresh]) beim Board-Wechsel wirklich: React raeumt den
  // Effekt der VORHERIGEN workingDir auf (Watcher schliessen), bevor der
  // Effekt fuer die neue workingDir laeuft (siehe Bericht an team-lead).
  const [workingDir, setWorkingDir] = useState(initialWorkingDir);
  const [mode, setMode] = useState<Mode>("board");
  const [selectedCol, setSelectedCol] = useState(INITIAL_SELECTED_COLUMN);
  const [selectedRow, setSelectedRow] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [filterText, setFilterText] = useState("");
  const [detailTask, setDetailTask] = useState<import("../core/types.ts").Task | null>(null);
  const [archivedTasks, setArchivedTasks] = useState<import("../core/types.ts").Task[]>([]);
  const [moving, setMoving] = useState(false);
  const [importPath, setImportPath] = useState("");
  const [pendingOverride, setPendingOverride] = useState<PendingOverride | null>(null);
  // P2-3 (K-2, Anschlussfrage 2): reiner Ansichtsmodus, schreibt nie 'position'.
  // Muss VOR dem useBoard()-Aufruf stehen, damit 'moving' zur Berechnung von
  // effectiveSort bereits verfuegbar ist (siehe resolveEffectiveSort).
  const [sortByPriority, setSortByPriority] = useState(false);
  const effectiveSort = resolveEffectiveSort(sortByPriority, moving);
  const board = useBoard(workingDir, effectiveSort);

  // Terminal-Hoehe tracken fuer festes Layout
  const { stdout } = useStdout();
  const [termRows, setTermRows] = useState(stdout?.rows ?? 24);
  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setTermRows(stdout.rows);
    stdout.on("resize", onResize);
    return () => { stdout.off("resize", onResize); };
  }, [stdout]);

  useEffect(() => { board.refresh(); }, [board.refresh]);

  // Gefilterte Tasks
  const filteredTasks = filterText
    ? board.tasks.filter(t => t.title.toLowerCase().includes(filterText.toLowerCase()))
    : board.tasks;

  // Aktive Spalte kommt aus displayColumns (echte Spalten + ggf. virtuelle
  // Sammelspalte, P1-6) -- fuer die Sammelspalte zaehlt "gehoert dazu" als
  // "Spalte des Tasks ist eine Waise", nicht als ID-Gleichheit (die Sentinel-ID
  // existiert real bei keinem Task).
  const activeColumn = board.displayColumns[selectedCol];
  const currentColTasks = activeColumn
    ? filteredTasks.filter(t =>
        activeColumn.id === ORPHAN_COLUMN_ID ? isOrphanTask(t, board.columns) : t.columnId === activeColumn.id)
    : [];

  const selectedTask = currentColTasks[selectedRow] ?? null;

  // Selektion begrenzen
  useEffect(() => {
    if (selectedRow >= currentColTasks.length && currentColTasks.length > 0) {
      setSelectedRow(currentColTasks.length - 1);
    }
  }, [currentColTasks.length, selectedRow]);

  // Komplette Tastatur-Kaskade (Modi, Navigation, Override-Dialog) lebt in
  // use-input-modes.ts -- ausgelagert, weil app.tsx sonst die 420-Zeilen-
  // Stoppgrenze aus den Task-Notes gerissen haette (siehe Kommentar dort und
  // Bericht an team-lead). Reine Verhaltens-Verschiebung, State bleibt hier.
  useInputModes({
    workingDir,
    exit,
    board,
    mode,
    selectedCol,
    selectedRow,
    moving,
    detailTask,
    importPath,
    pendingOverride,
    selectedTask,
    currentColTaskCount: currentColTasks.length,
    sortByPriority,
    setMode,
    setStatusMsg,
    setSelectedCol,
    setSelectedRow,
    setMoving,
    setFilterText,
    setDetailTask,
    setPendingOverride,
    setArchivedTasks,
    setSortByPriority,
  });

  if (!boardExists(workingDir)) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">Kein Board gefunden.</Text>
        <Text>Zuerst 'kanban init' ausfuehren.</Text>
      </Box>
    );
  }

  // Save/Cancel-Handler der Detailansicht (Notizen, Tags, Prioritaet, Titel,
  // Beschreibung) leben in use-detail-handlers.ts -- ausgelagert, weil
  // app.tsx sonst die 420-Zeilen-Stoppgrenze aus den Task-Notes gerissen
  // haette (siehe Kommentar dort und Bericht an team-lead). Reine
  // Verhaltens-Verschiebung, State bleibt hier.
  const {
    handleNoteSave, handleNoteCancel,
    handleTagsSave, handleTagsCancel,
    handlePrioritySave, handlePriorityCancel,
    handleTitleSave, handleTitleCancel,
    handleDescSave, handleDescCancel,
  } = useDetailHandlers({ board, detailTask, setMode, setStatusMsg, setDetailTask });

  const handleAddCancel = () => {
    setMode("board");
    setStatusMsg("Abgebrochen");
  };

  const handleFilterCancel = () => {
    setMode("board");
    setStatusMsg("");
  };

  const handleExportCancel = () => {
    setMode("board");
    setStatusMsg("");
  };

  const handleImportCancel = () => {
    setMode("board");
    setStatusMsg("");
  };

  // P3-3: Board wechseln. BoardPicker laesst nur 'ok'-Eintraege ueberhaupt an
  // onSelect durchkommen (siehe board-picker.tsx) -- diese Funktion muss den
  // Status also nicht nochmal pruefen. Die Zustaende der Board-Ansicht
  // (Spalte/Zeile/Filter/Detail/Verschieben) gehoeren zum alten Board und
  // werden zurueckgesetzt (Kanban-Notes hI3444NiI5DG, "Zustand
  // zuruecksetzen") -- sonst zeigt z.B. die Detailansicht einen Task, den es
  // im neuen Board nicht gibt.
  const handleBoardSelect = (entry: import("../cli/board-overview.ts").BoardOverviewEntry) => {
    setWorkingDir(entry.path);
    setSelectedCol(INITIAL_SELECTED_COLUMN);
    setSelectedRow(0);
    setFilterText("");
    setDetailTask(null);
    setMoving(false);
    setStatusMsg(`Board gewechselt: ${entry.name}`);
    setMode("board");
  };

  const handleBoardCancel = () => {
    setMode("board");
    setStatusMsg("");
  };

  const detailModes: Mode[] = ["detail", "edit-notes", "edit-tags", "edit-title", "edit-description", "edit-deps", "edit-priority"];
  if (detailModes.includes(mode) && detailTask) return (
    <Box flexDirection="column">
      <DetailView task={detailTask} />
      {mode === "edit-notes" && (
        <TextArea
          initialValue={detailTask.notes ?? ""}
          onSave={handleNoteSave}
          onCancel={handleNoteCancel}
        />
      )}
      {mode === "edit-tags" && (
        <TagPicker
          selectedTags={detailTask.labels}
          onSave={handleTagsSave}
          onCancel={handleTagsCancel}
        />
      )}
      {mode === "edit-priority" && (
        <PriorityPicker
          selected={detailTask.priority}
          onSave={handlePrioritySave}
          onCancel={handlePriorityCancel}
        />
      )}
      {mode === "edit-title" && (
        <TitleInput
          initialValue={detailTask.title}
          onSubmit={handleTitleSave}
          onCancel={handleTitleCancel}
        />
      )}
      {mode === "edit-description" && (
        <DescInput
          initialValue={detailTask.description ?? ""}
          onSubmit={handleDescSave}
          onCancel={handleDescCancel}
        />
      )}
      {mode === "edit-deps" && (
        <DependencyView
          task={detailTask}
          dependencies={board.getDependencies(detailTask.id)}
          dependents={board.getDependents(detailTask.id)}
          onAdd={(depId) => {
            try {
              board.addDependency(detailTask.id, depId);
              const refreshed = board.getTask(detailTask.id);
              if (refreshed) setDetailTask(refreshed);
              setStatusMsg("Abhaengigkeit hinzugefuegt");
            } catch (e: any) {
              setStatusMsg(e.message);
            }
          }}
          onRemove={(depId) => {
            board.removeDependency(detailTask.id, depId);
            const refreshed = board.getTask(detailTask.id);
            if (refreshed) setDetailTask(refreshed);
            setStatusMsg("Abhaengigkeit entfernt");
          }}
          onBack={() => { setMode("detail"); setStatusMsg(""); }}
        />
      )}
    </Box>
  );
  if (mode === "archive") return (
    <ArchiveView
      tasks={archivedTasks}
      onRestore={(id) => {
        board.restoreTask(id);
        setArchivedTasks(board.listArchived());
        setStatusMsg("Task wiederhergestellt");
      }}
      onDelete={(id) => {
        board.deleteTask(id);
        setArchivedTasks(board.listArchived());
        setStatusMsg("Archivierter Task geloescht");
      }}
      onPurge={() => {
        const { deletedCount } = board.purgeArchive();
        setArchivedTasks([]);
        setStatusMsg(`${deletedCount} archivierte Tasks geloescht`);
      }}
      onBack={() => { setMode("board"); setStatusMsg(""); }}
    />
  );
  if (mode === "help") return <HelpView />;
  if (mode === "board-picker") return (
    <BoardPicker currentPath={workingDir} onSelect={handleBoardSelect} onCancel={handleBoardCancel} />
  );

  const handleExportSubmit = async (val: string) => {
    const path = val.trim();
    if (!path) { setMode("board"); setStatusMsg(""); return; }
    setMode("board"); setStatusMsg("Exportiere...");
    try {
      const zipPath = await exportBoard(workingDir, path);
      setStatusMsg(`Exportiert: ${zipPath}`);
    } catch (err) { setStatusMsg(`Export-Fehler: ${(err as Error).message}`); }
  };

  const handleImportSubmit = (val: string) => {
    const path = val.trim();
    if (!path) { setMode("board"); setStatusMsg(""); return; }
    setImportPath(path); setMode("import-confirm");
  };

  const handleAddSubmit = (val: string) => {
    const title = val.trim();
    if (title) {
      const targetCol = board.displayColumns[selectedCol];
      const result = board.addTask(title, targetCol?.id);
      if (result.redirectedTo) {
        // Eintrittsregel (P1-5 Teil 2): Anlegen ist keine Ausnahme-Situation,
        // sondern eine Fehlbedienung -- still nach Todo umleiten, kein Dialog
        // (Plan Abschnitt 3.4). Cursor folgt dorthin, analog zum bisherigen
        // Verhalten bei normalem Anlegen.
        const todoIdx = board.displayColumns.findIndex(c => c.id === "todo");
        if (todoIdx !== -1) { setSelectedCol(todoIdx); setSelectedRow(0); }
        setStatusMsg("Neue Tasks nur in Backlog oder Todo — angelegt in Todo");
      } else {
        setStatusMsg(`"${title}" -> ${targetCol?.name ?? "Todo"}`);
      }
    }
    setMode("board");
  };

  const handleFilterSubmit = (val: string) => {
    setFilterText(val.trim());
    setStatusMsg(val.trim() ? `Filter: "${val.trim()}"` : "Filter aufgehoben");
    setSelectedRow(0);
    setMode("board");
  };

  return (
    // termRows - 1: bleibt die Ausgabe unter stdout.rows, faellt Ink nicht in
    // seinen Vollbild-Pfad (ink.js: lastOutputHeight >= stdout.rows) und
    // schreibt keinen ESC[2J ESC[3J bei jedem Frame -- siehe Plan
    // .claude/plans/tui-input-flicker.md, Schritt 1.
    <Box flexDirection="column" width="100%" height={termRows - 1}>
      {/* Header — fixiert */}
      <Box justifyContent="center" paddingY={0} flexShrink={0}>
        <Text bold color="#3b82f6"> KANBAN </Text>
        <Text bold color={ACCENT.muted}>|</Text>
        <Text color={ACCENT.title}> {board.displayColumns[selectedCol]?.name ?? "Board"} </Text>
        {filterText && <Text color={ACCENT.notes}> [Filter: {filterText}]</Text>}
        {/* Zeigt nur an, wenn die Sortierung TATSAECHLICH wirkt (effectiveSort),
            nicht schon bei blossem sortByPriority=true -- verschwindet also von
            selbst im Verschiebe-Modus, ohne eigenen Text dafuer zu brauchen. */}
        {effectiveSort === "priority" && <Text color={ACCENT.labels}> [Prioritaet]</Text>}
      </Box>

      {/* Board — flexibel, clippt bei Overflow */}
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <BoardView columns={board.displayColumns} tasks={filteredTasks} selectedCol={selectedCol} selectedRow={selectedRow} moving={moving} />
      </Box>

      {/* Footer — fixiert */}
      <Box flexDirection="column" flexShrink={0}>
        {mode === "add" && <AddInput onSubmit={handleAddSubmit} onCancel={handleAddCancel} />}
        {mode === "filter" && <FilterInput onSubmit={handleFilterSubmit} onCancel={handleFilterCancel} />}
        {mode === "confirm-delete" && selectedTask && <DeleteConfirm task={selectedTask} />}
        {mode === "export-path" && (
          <ExportInput
            initialValue={`./kanban-export-${new Date().toISOString().slice(0, 10)}.zip`}
            onSubmit={handleExportSubmit}
            onCancel={handleExportCancel}
          />
        )}
        {mode === "import-path" && <ImportInput onSubmit={handleImportSubmit} onCancel={handleImportCancel} />}
        {mode === "import-confirm" && <ImportConfirm />}
        {mode === "confirm-override" && pendingOverride && <OverrideConfirm reason={pendingOverride.reason} />}
        <StatusBar message={statusMsg} />
      </Box>
    </Box>
  );
}
