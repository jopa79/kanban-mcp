// Zentrale Farbkonstanten fuer die Kanban TUI

// Spaltenfarben — klar unterscheidbar im Terminal
export const COLUMN_COLORS: Record<string, string> = {
  backlog: "#6b7280",       // gedaempftes Grau
  todo: "#f59e0b",          // Amber/Orange
  "in-progress": "#3b82f6", // kraeftiges Blau
  review: "#a855f7",        // Lila
  done: "#22c55e",          // Gruen
};

// Fallback wenn Spalten-ID unbekannt
export const DEFAULT_COLUMN_COLOR = "#94a3b8";

// Akzentfarben fuer Task-Elemente
export const ACCENT = {
  notes: "#f59e0b",      // Amber — Notiz-Indikator
  assignee: "#38bdf8",   // Hellblau — Zugewiesen an
  labels: "#c084fc",     // Helles Lila — Label-Tags
  wipWarn: "#ef4444",    // Rot — WIP-Limit ueberschritten
  title: "#e2e8f0",      // Helles Grau — Titel-Text
  muted: "#64748b",      // Gedaempft — IDs, Meta-Info
  selected: "#1e293b",   // Dunkler Hintergrund fuer Selektion
};

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
