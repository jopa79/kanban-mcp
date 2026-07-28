// Board- und Spalten-Verwaltung
import type { Database } from "bun:sqlite";
import type { BoardConfig, Column, ColumnConfig } from "./types.ts";

export class BoardService {
  constructor(
    private db: Database,
    private config: BoardConfig,
  ) {}

  // ColumnConfig (aus config.json, ohne position) + Array-Index -> Column
  // (Domain-Objekt, mit position). Die Array-Reihenfolge in config.columns IST
  // die Reihenfolge (ADR 0001) — position wird nie aus der Datei gelesen.
  private toColumn(columnConfig: ColumnConfig, index: number): Column {
    return { ...columnConfig, position: index };
  }

  // Alle Spalten in der Reihenfolge aus config.json. NICHT sortieren — es gibt
  // kein position-Feld in der Config, die Array-Reihenfolge ist die Ordnung.
  getColumns(): Column[] {
    return this.config.columns.map((c, i) => this.toColumn(c, i));
  }

  // Einzelne Spalte per ID
  getColumn(id: string): Column | null {
    const index = this.config.columns.findIndex((c) => c.id === id);
    if (index === -1) return null;
    return this.toColumn(this.config.columns[index]!, index);
  }

  // Terminal-Spalte finden (z.B. "Done")
  getTerminalColumn(): Column | null {
    const index = this.config.columns.findIndex((c) => c.isTerminal);
    if (index === -1) return null;
    return this.toColumn(this.config.columns[index]!, index);
  }

  // Anzahl aktiver Tasks in einer Spalte — bleibt SQL, zaehlt Tasks, nicht Spalten
  getColumnTaskCount(columnId: string): number {
    const result = this.db
      .query("SELECT COUNT(*) as count FROM tasks WHERE column_id = ? AND archived = 0")
      .get(columnId) as { count: number } | null;
    return result?.count ?? 0;
  }

  // Spalten-IDs, auf die Tasks zeigen, die aber in config.columns fehlen.
  // Ursachen: manuell editierte config.json, Import eines Boards mit anderen
  // Spalten, abgebrochene Migration. Wird nicht repariert oder versteckt,
  // nur sichtbar gemacht (TUI-Sammelspalte, kanban status) — siehe ADR 0001.
  getOrphanColumnIds(): string[] {
    const rows = this.db
      .query("SELECT DISTINCT column_id FROM tasks WHERE archived = 0")
      .all() as Array<{ column_id: string }>;
    const knownIds = new Set(this.config.columns.map((c) => c.id));
    return rows.map((r) => r.column_id).filter((id) => !knownIds.has(id));
  }
}
