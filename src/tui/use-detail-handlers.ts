// Detail-Handler der TUI als eigener Hook.
//
// Grund: T5 (Kanban-Task D8jcp_85hnOE) bringt app.tsx wieder unter die
// 420-Zeilen-Stoppgrenze aus den Task-Notes -- derselbe Anlass wie beim
// Schnitt von use-input-modes.ts (siehe Kommentar dort). Der Plan
// (.claude/plans/tui-search-jump.md, Abschnitt T5) benennt den Ausweg
// explizit: die Handler der Detailansicht (handleNoteSave bis
// handleDescCancel, rund 80 Zeilen) in einen eigenen Hook verschieben.
// Reine Verhaltens-Verschiebung (Copy+Parametrisierung), kein Umbau der
// State-Owner-Struktur: app.tsx behaelt seinen useState-Zoo, dieser Hook
// bekommt die aktuellen Werte + Setter hereingereicht, genau wie bei
// use-input-modes.ts.
import { NotesService } from "../core/notes-service.ts";
import type { Task, TaskPriority } from "../core/types.ts";
import type { useBoard } from "./use-board.ts";
import type { Mode } from "./use-input-modes.ts";
import { getPriorityLabel } from "./theme.ts";

type Board = ReturnType<typeof useBoard>;

export interface UseDetailHandlersArgs {
  board: Board;
  detailTask: Task | null;
  setMode: (mode: Mode) => void;
  setStatusMsg: (msg: string) => void;
  setDetailTask: (task: Task | null) => void;
}

export interface DetailHandlers {
  handleNoteSave: (val: string) => void;
  handleNoteCancel: () => void;
  handleTagsSave: (tags: string[]) => void;
  handleTagsCancel: () => void;
  handlePrioritySave: (priority: TaskPriority | null) => void;
  handlePriorityCancel: () => void;
  handleTitleSave: (val: string) => void;
  handleTitleCancel: () => void;
  handleDescSave: (val: string) => void;
  handleDescCancel: () => void;
}

// Buendelt die Save/Cancel-Handler der Detailansicht (Notizen, Tags,
// Prioritaet, Titel, Beschreibung). Kein Ink-useInput() hier -- anders als
// use-input-modes.ts registriert dieser Hook keine Tastatur-Kaskade, seine
// Handler werden direkt als Callback-Props an TextArea/TagPicker/
// PriorityPicker/TitleInput/DescInput gereicht (siehe app.tsx).
export function useDetailHandlers(args: UseDetailHandlersArgs): DetailHandlers {
  const { board, detailTask, setMode, setStatusMsg, setDetailTask } = args;

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

  const handlePrioritySave = (priority: TaskPriority | null) => {
    if (detailTask) {
      board.updateTask(detailTask.id, { priority });
      const refreshed = board.getTask(detailTask.id);
      if (refreshed) setDetailTask(refreshed);
      setStatusMsg(`Prioritaet: ${getPriorityLabel(priority)}`);
    }
    setMode("detail");
  };

  const handlePriorityCancel = () => {
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

  // Esc-Abbruch fuer Titel/Beschreibung: die Statuszeile versprach schon
  // vorher "(Esc=Abbrechen)", aber ink-text-input kannte kein Esc -- das war
  // tot (siehe #50, Plan Schritt 2). LineInput bringt Esc jetzt tatsaechlich
  // zum Wirken, deshalb hier nachgezogen, analog zu handleNoteCancel/
  // handleTagsCancel.
  const handleTitleCancel = () => {
    setMode("detail");
    setStatusMsg("");
  };

  const handleDescCancel = () => {
    setMode("detail");
    setStatusMsg("");
  };

  return {
    handleNoteSave, handleNoteCancel,
    handleTagsSave, handleTagsCancel,
    handlePrioritySave, handlePriorityCancel,
    handleTitleSave, handleTitleCancel,
    handleDescSave, handleDescCancel,
  };
}
