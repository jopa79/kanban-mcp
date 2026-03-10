// Ink Root Component — Interaktive Kanban TUI
import React, { useState, useEffect } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { boardExists } from "../core/db.ts";
import { NotesService } from "../core/notes-service.ts";
import { exportBoard, importBoard } from "../core/export-service.ts";
import { BoardView } from "./board-view.tsx";
import { DetailView } from "./detail-view.tsx";
import { HelpView } from "./help-view.tsx";
import { AddInput, FilterInput, TitleInput, DescInput, DeleteConfirm, ExportInput, ImportInput, ImportConfirm, StatusBar } from "./status-bar.tsx";
import { TextArea } from "./text-area.tsx";
import { TagPicker } from "./tag-picker.tsx";
import { ArchiveView } from "./archive-view.tsx";
import { DependencyView } from "./dependency-view.tsx";
import { useBoard } from "./use-board.ts";
import { getColumnColor, ACCENT } from "./theme.ts";

type Mode = "board" | "detail" | "add" | "filter" | "confirm-delete" | "help" | "edit-notes" | "edit-tags" | "edit-title" | "edit-description" | "archive" | "edit-deps" | "export-path" | "import-path" | "import-confirm";

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

  const currentColTasks = board.columns.length > 0
    ? filteredTasks.filter(t => t.columnId === board.columns[selectedCol]?.id)
    : [];

  const selectedTask = currentColTasks[selectedRow] ?? null;

  // Selektion begrenzen
  useEffect(() => {
    if (selectedRow >= currentColTasks.length && currentColTasks.length > 0) {
      setSelectedRow(currentColTasks.length - 1);
    }
  }, [currentColTasks.length, selectedRow]);

  useInput((input, key) => {
    // Esc in Export/Import-Pfadeingabe: abbrechen
    if (key.escape && (mode === "export-path" || mode === "import-path")) {
      setMode("board"); setStatusMsg(""); return;
    }

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

    // Texteingabe-Modi: kein Key-Handling hier (Komponenten handeln selbst)
    if (mode === "add" || mode === "filter" || mode === "edit-notes" || mode === "edit-tags" || mode === "edit-title" || mode === "edit-description" || mode === "edit-deps" || mode === "export-path" || mode === "import-path") return;

    if (mode === "detail") {
      if (input === "q" || key.escape) { setMode("board"); setDetailTask(null); setStatusMsg(""); }
      if (input === "e" && detailTask) {
        setMode("edit-notes");
      }
      if (input === "t" && detailTask) {
        setMode("edit-tags");
      }
      if (input === "T" && detailTask) {
        setInputValue(detailTask.title);
        setMode("edit-title");
      }
      if (input === "b" && detailTask) {
        setInputValue(detailTask.description ?? "");
        setMode("edit-description");
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
      // Verschiebe-Modus: Pfeiltasten bewegen den Task
      if (key.leftArrow && selectedCol > 0) {
        const target = board.columns[selectedCol - 1]!;
        board.moveTask(selectedTask.id, target.id);
        setSelectedCol(selectedCol - 1); setSelectedRow(0);
        setStatusMsg(`VERSCHIEBEN -> ${target.name}`);
      }
      if (key.rightArrow && selectedCol < board.columns.length - 1) {
        const target = board.columns[selectedCol + 1]!;
        board.moveTask(selectedTask.id, target.id);
        setSelectedCol(selectedCol + 1); setSelectedRow(0);
        setStatusMsg(`VERSCHIEBEN -> ${target.name}`);
      }
      if (key.upArrow) { board.reorderTask(selectedTask.id, "up"); setSelectedRow(Math.max(0, selectedRow - 1)); setStatusMsg("VERSCHIEBEN ↑"); }
      if (key.downArrow) { board.reorderTask(selectedTask.id, "down"); setSelectedRow(Math.min(currentColTasks.length - 1, selectedRow + 1)); setStatusMsg("VERSCHIEBEN ↓"); }
      return;
    }

    // Navigations-Modus: Pfeiltasten bewegen den Cursor
    if (key.leftArrow) { setSelectedCol(Math.max(0, selectedCol - 1)); setSelectedRow(0); setStatusMsg(""); }
    if (key.rightArrow) { setSelectedCol(Math.min(board.columns.length - 1, selectedCol + 1)); setSelectedRow(0); setStatusMsg(""); }
    if (key.upArrow) { setSelectedRow(Math.max(0, selectedRow - 1)); setStatusMsg(""); }
    if (key.downArrow) { setSelectedRow(Math.min(currentColTasks.length - 1, selectedRow + 1)); setStatusMsg(""); }
    if (key.return && selectedTask) {
      const full = board.getTask(selectedTask.id);
      setDetailTask(full);
      setMode("detail");
    }
    if (input === "t" && selectedTask && selectedTask.columnId === "backlog") { board.moveTask(selectedTask.id, "todo"); setStatusMsg(`"${selectedTask.title}" -> Todo`); }
    if (input === "d" && selectedTask) { board.completeTask(selectedTask.id); setStatusMsg(`-> Done`); }
    if (input === "n") { setInputValue(""); setMode("add"); }
    if (input === "x" && selectedTask) { setMode("confirm-delete"); }
    if (input === "a" && selectedTask) { board.archiveTask(selectedTask.id); setStatusMsg(`"${selectedTask.title}" archiviert`); setSelectedRow(Math.max(0, selectedRow - 1)); }
    if (input === "/") { setInputValue(""); setMode("filter"); }
    if (input === "r") { board.refresh(); setStatusMsg("Aktualisiert"); }
    if (input === "?") { setMode("help"); }
    if (input === "A") { setArchivedTasks(board.listArchived()); setMode("archive"); }
    if (input === "E") {
      const date = new Date().toISOString().slice(0, 10);
      setInputValue(`./kanban-export-${date}.zip`);
      setMode("export-path");
    }
    if (input === "I") { setInputValue(""); setMode("import-path"); }
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
    if (val.trim()) {
      const targetCol = board.columns[selectedCol];
      const colId = targetCol?.id;
      board.addTask(val.trim(), colId);
      setStatusMsg(`"${val.trim()}" -> ${targetCol?.name ?? "Todo"}`);
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
        <Text color={ACCENT.title}> {board.columns[selectedCol]?.name ?? "Board"} </Text>
        {filterText && <Text color={ACCENT.notes}> [Filter: {filterText}]</Text>}
      </Box>

      {/* Board — flexibel, clippt bei Overflow */}
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <BoardView columns={board.columns} tasks={filteredTasks} selectedCol={selectedCol} selectedRow={selectedRow} moving={moving} />
      </Box>

      {/* Footer — fixiert */}
      <Box flexDirection="column" flexShrink={0}>
        {mode === "add" && <AddInput value={inputValue} onChange={setInputValue} onSubmit={handleAddSubmit} />}
        {mode === "filter" && <FilterInput value={inputValue} onChange={setInputValue} onSubmit={handleFilterSubmit} />}
        {mode === "confirm-delete" && selectedTask && <DeleteConfirm task={selectedTask} />}
        {mode === "export-path" && <ExportInput value={inputValue} onChange={setInputValue} onSubmit={handleExportSubmit} />}
        {mode === "import-path" && <ImportInput value={inputValue} onChange={setInputValue} onSubmit={handleImportSubmit} />}
        {mode === "import-confirm" && <ImportConfirm />}
        <StatusBar message={statusMsg} />
      </Box>
    </Box>
  );
}
