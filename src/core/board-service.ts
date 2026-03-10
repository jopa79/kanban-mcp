// Board- und Spalten-Verwaltung
import type { Database } from "bun:sqlite";
import type { Column, ColumnRow } from "./types.ts";
import { rowToColumn } from "./types.ts";

export class BoardService {
  constructor(private db: Database) {}

  // Alle Spalten sortiert nach Position
  getColumns(): Column[] {
    const rows = this.db
      .query("SELECT * FROM columns ORDER BY position ASC")
      .all() as ColumnRow[];
    return rows.map(rowToColumn);
  }

  // Einzelne Spalte per ID
  getColumn(id: string): Column | null {
    const row = this.db
      .query("SELECT * FROM columns WHERE id = ?")
      .get(id) as ColumnRow | null;
    return row ? rowToColumn(row) : null;
  }

  // Terminal-Spalte finden (z.B. "Done")
  getTerminalColumn(): Column | null {
    const row = this.db
      .query("SELECT * FROM columns WHERE is_terminal = 1 LIMIT 1")
      .get() as ColumnRow | null;
    return row ? rowToColumn(row) : null;
  }

  // Anzahl aktiver Tasks in einer Spalte
  getColumnTaskCount(columnId: string): number {
    const result = this.db
      .query("SELECT COUNT(*) as count FROM tasks WHERE column_id = ? AND archived = 0")
      .get(columnId) as { count: number } | null;
    return result?.count ?? 0;
  }
}
