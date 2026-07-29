// Zentrale Farbkonstanten fuer die Kanban TUI
import type { TaskPriority } from "../core/types.ts";

// Akzentfarben fuer Task-Elemente
export const ACCENT = {
  notes: "#f59e0b",      // Amber — Notiz-Indikator
  assignee: "#38bdf8",   // Hellblau — Zugewiesen an
  labels: "#c084fc",     // Helles Lila — Label-Tags
  wipWarn: "#ef4444",    // Rot — WIP-Limit ueberschritten / Blockiert-Marker
  title: "#e2e8f0",      // Helles Grau — Titel-Text
  muted: "#64748b",      // Gedaempft — IDs, Meta-Info
  selected: "#1e293b",   // Dunkler Hintergrund fuer Selektion
  // P2-3: eigener Ton (Orange), bewusst NICHT identisch mit wipWarn (Rot) --
  // ein Task kann gleichzeitig blockiert UND ueberfaellig sein, zwei
  // Klammer-Marker ("[B]", "[!]") in exakt derselben Farbe waeren auf der
  // schmalen Karte schwerer auseinanderzuhalten als zwei unterscheidbare
  // Toene. #f97316 existiert im Datei bereits als 'duplicate'-Tag-Farbe --
  // bewusste Wiederverwendung statt eines weiteren, kaum unterscheidbaren
  // Rot-Tons (siehe PRIORITY_COLORS-Kommentar fuer dasselbe Prinzip).
  overdue: "#f97316",    // Orange — Ueberfaellig-Marker
};

// Sentinel-ID der virtuellen Sammelspalte fuer Waisen-Tasks (P1-6, ADR 0001).
// Kein Task hat diese column_id jemals real in der DB — sie taucht nur in der
// aus 'columns' abgeleiteten Anzeige-Liste auf (siehe use-board.ts:
// displayColumns/isOrphanTask, board-view.tsx).
export const ORPHAN_COLUMN_ID = "__orphan__";

// Spaltenfarben — klar unterscheidbar im Terminal
export const COLUMN_COLORS: Record<string, string> = {
  backlog: "#e2e8f0",       // helles Weiss
  todo: "#f59e0b",          // Amber/Orange
  "in-progress": "#3b82f6", // kraeftiges Blau
  review: "#a855f7",        // Lila
  done: "#22c55e",          // Gruen
  [ORPHAN_COLUMN_ID]: ACCENT.wipWarn, // Warnfarbe — Waisen sind ein Hinweis, keine normale Spalte
};

// Fallback wenn Spalten-ID unbekannt
export const DEFAULT_COLUMN_COLOR = "#94a3b8";

// Vordefinierte Tags mit Farben (orientiert an GitHub Issue Labels)
export interface TagDef {
  name: string;
  color: string;
}

export const TAGS: TagDef[] = [
  { name: "bug",          color: "#ef4444" }, // Rot
  { name: "feature",      color: "#22c55e" }, // Gruen
  { name: "enhancement",  color: "#3b82f6" }, // Blau
  { name: "docs",         color: "#a855f7" }, // Lila
  { name: "refactor",     color: "#f59e0b" }, // Amber
  { name: "test",         color: "#06b6d4" }, // Cyan
  { name: "chore",        color: "#6b7280" }, // Grau
  { name: "urgent",       color: "#dc2626" }, // Kräftiges Rot
  { name: "wontfix",      color: "#4b5563" }, // Dunkles Grau
  { name: "duplicate",    color: "#f97316" }, // Orange
  { name: "help-wanted",  color: "#10b981" }, // Smaragd
];

// Hex-Farbe abdunkeln (factor 0-1, 0=schwarz, 1=original)
export function dimHexColor(hex: string, factor: number): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// Farbe eines Tags nachschlagen
export function getTagColor(tagName: string): string {
  return TAGS.find(t => t.name === tagName)?.color ?? DEFAULT_COLUMN_COLOR;
}

// Hilfsfunktion: Spaltenfarbe holen
export function getColumnColor(columnId: string): string {
  return COLUMN_COLORS[columnId] ?? DEFAULT_COLUMN_COLOR;
}

// Prioritaets-Farben (P2-3): high/medium/low nutzen bewusst dieselben Hex-
// Werte wie thematisch verwandte, bereits vorhandene Marker (wipWarn/notes/
// assignee) statt dreier neuer, kaum unterscheidbarer Rot-/Amber-Toene --
// konsistent mit der bestehenden Mehrfachnutzung von Hex-Werten in
// COLUMN_COLORS/TAGS (z.B. #ef4444 fuer wipWarn UND den 'bug'-Tag). 'null'
// (keine Prioritaet) bleibt exklusiv ACCENT.muted -- keine der drei echten
// Stufen teilt sich die Farbe mit "nicht gesetzt", sonst waere 'low' von
// 'keine Prioritaet' farblich nicht zu unterscheiden.
const PRIORITY_COLORS: Record<TaskPriority, string> = {
  high: ACCENT.wipWarn,   // Rot — verlangt Aufmerksamkeit, wie Blockiert/WIP-Warnung
  medium: ACCENT.notes,   // Amber — mittlere Dringlichkeit, wie der Notiz-Indikator
  low: ACCENT.assignee,   // Hellblau — ruhig, keine Dringlichkeit
};

export function getPriorityColor(priority: TaskPriority | null): string {
  return priority ? PRIORITY_COLORS[priority] : ACCENT.muted;
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: "Hoch",
  medium: "Mittel",
  low: "Niedrig",
};

// "—" analog zum bestehenden Platzhalter fuer eine leere Beschreibung
// (detail-view.tsx: task.description ?? "—") -- ein Bindestrich fuer "nicht
// gesetzt" ist in dieser Ansicht bereits etabliertes Vokabular.
export function getPriorityLabel(priority: TaskPriority | null): string {
  return priority ? PRIORITY_LABELS[priority] : "—";
}
