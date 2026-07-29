// Ink Root Component — Interaktive Kanban TUI
import React, { useState, useEffect } from "react";
import { Box, Text, useApp, useStdout } from "ink";
import { boardExists } from "../core/db.ts";
import { NotesService } from "../core/notes-service.ts";
import { exportBoard } from "../core/export-service.ts";
import { BoardView } from "./board-view.tsx";
import { DetailView } from "./detail-view.tsx";
import { HelpView } from "./help-view.tsx";
import { AddInput, FilterInput, TitleInput, DescInput, DeleteConfirm, ExportInput, ImportInput, ImportConfirm, OverrideConfirm, StatusBar } from "./status-bar.tsx";
import { TextArea } from "./text-area.tsx";
import { TagPicker } from "./tag-picker.tsx";
import { ArchiveView } from "./archive-view.tsx";
import { DependencyView } from "./dependency-view.tsx";
import { useBoard, isOrphanTask } from "./use-board.ts";
import { useInputModes, type Mode, type PendingOverride } from "./use-input-modes.ts";
import { getColumnColor, ACCENT, ORPHAN_COLUMN_ID } from "./theme.ts";

interface AppProps {
  workingDir: string;
}

export function App({ workingDir }: AppProps) {
  const { exit } = useApp();
  const board = useBoard(workingDir);
  const [mode, setMode] = useState<Mode>("board");
  const [selectedCol, setSelectedCol] = useState(1);
  const [selectedRow, setSelectedRow] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [filterText, setFilterText] = useState("");
  const [detailTask, setDetailTask] = useState<import("../core/types.ts").Task | null>(null);
  const [archivedTasks, setArchivedTasks] = useState<import("../core/types.ts").Task[]>([]);
  const [moving, setMoving] = useState(false);
  const [importPath, setImportPath] = useState("");
  const [pendingOverride, setPendingOverride] = useState<PendingOverride | null>(null);

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
    setMode,
    setStatusMsg,
    setSelectedCol,
    setSelectedRow,
    setMoving,
    setFilterText,
    setDetailTask,
    setInputValue,
    setPendingOverride,
    setArchivedTasks,
  });

  if (!boardExists(workingDir)) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">Kein Board gefunden.</Text>
        <Text>Zuerst 'kanban init' ausfuehren.</Text>
      </Box>
    );
  }

  const handleNoteSave = (val: string) => {
    if (detailTask) {
      const notesService = new NotesService(board.kanbanDir);
      notesService.save(detailTask.id, val.trim());
      board.refresh();
      const refreshed = board.getTask(detailTask.id);
      if (refreshed) setDetailTask(refreshed);
      setStatusMsg("Notizen gespeichert");
    }
    setMode("detail");
  };

  const handleNoteCancel = () => {
    setMode("detail");
    setStatusMsg("");
  };

  const handleTagsSave = (tags: string[]) => {
    if (detailTask) {
      board.updateTask(detailTask.id, { labels: tags });
      const refreshed = board.getTask(detailTask.id);
      if (refreshed) setDetailTask(refreshed);
      setStatusMsg(`Tags: ${tags.length > 0 ? tags.join(", ") : "keine"}`);
    }
    setMode("detail");
  };

  const handleTagsCancel = () => {
    setMode("detail");
    setStatusMsg("");
  };

  const handleTitleSave = (val: string) => {
    if (detailTask && val.trim()) {
      board.updateTask(detailTask.id, { title: val.trim() });
      const refreshed = board.getTask(detailTask.id);
      if (refreshed) setDetailTask(refreshed);
      setStatusMsg("Titel aktualisiert");
    }
    setMode("detail");
  };

  const handleDescSave = (val: string) => {
    if (detailTask) {
      board.updateTask(detailTask.id, { description: val.trim() || null });
      const refreshed = board.getTask(detailTask.id);
      if (refreshed) setDetailTask(refreshed);
      setStatusMsg("Beschreibung aktualisiert");
    }
    setMode("detail");
  };

  const detailModes: Mode[] = ["detail", "edit-notes", "edit-tags", "edit-title", "edit-description", "edit-deps"];
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
      {mode === "edit-title" && (
        <TitleInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleTitleSave}
        />
      )}
      {mode === "edit-description" && (
        <DescInput
          value={inputValue}
          onChange={setInputValue}
          onSubmit={handleDescSave}
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
    <Box flexDirection="column" width="100%" height={termRows}>
      {/* Header — fixiert */}
      <Box justifyContent="center" paddingY={0} flexShrink={0}>
        <Text bold color="#3b82f6"> KANBAN </Text>
        <Text bold color={ACCENT.muted}>|</Text>
        <Text color={ACCENT.title}> {board.displayColumns[selectedCol]?.name ?? "Board"} </Text>
        {filterText && <Text color={ACCENT.notes}> [Filter: {filterText}]</Text>}
      </Box>

      {/* Board — flexibel, clippt bei Overflow */}
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <BoardView columns={board.displayColumns} tasks={filteredTasks} selectedCol={selectedCol} selectedRow={selectedRow} moving={moving} />
      </Box>

      {/* Footer — fixiert */}
      <Box flexDirection="column" flexShrink={0}>
        {mode === "add" && <AddInput value={inputValue} onChange={setInputValue} onSubmit={handleAddSubmit} />}
        {mode === "filter" && <FilterInput value={inputValue} onChange={setInputValue} onSubmit={handleFilterSubmit} />}
        {mode === "confirm-delete" && selectedTask && <DeleteConfirm task={selectedTask} />}
        {mode === "export-path" && <ExportInput value={inputValue} onChange={setInputValue} onSubmit={handleExportSubmit} />}
        {mode === "import-path" && <ImportInput value={inputValue} onChange={setInputValue} onSubmit={handleImportSubmit} />}
        {mode === "import-confirm" && <ImportConfirm />}
        {mode === "confirm-override" && pendingOverride && <OverrideConfirm reason={pendingOverride.reason} />}
        <StatusBar message={statusMsg} />
      </Box>
    </Box>
  );
}
