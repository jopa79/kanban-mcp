// Migration Schema v2 -> v3 (ADR 0001, Plan Abschnitt 2.3, Kanban-Task
// FOnChTsCvh8r). Die riskanteste Operation des Projekts: irreversible
// Umformung fremder Produktivdaten.
//
// Schritte 1-2 (Vorpruefung, Ableitung der neuen Spalten-Config) leben in
// migrate-v3-precheck.ts (rein lesend, eigene Verantwortung) und werden hier
// re-exportiert — Aufrufer (CLI, Tests) importieren weiterhin ausschliesslich
// aus dieser Datei. Verbindliche Reihenfolge ab hier:
//
//   3. Backup: board.db -> board.db.bak-v2 (VACUUM INTO, nie ueberschreiben)
//   4. config.json schreiben (atomar: tmp + fsync + rename) — uebersprungen,
//      wenn ein abgebrochener Vorlauf schon 'columns' geschrieben hat
//   5. config.json zuruecklesen und verifizieren (Abweichung = Abbruch,
//      DB ist an dieser Stelle noch unberuehrt)
//   6. EINE DB-Transaktion: transitions anlegen, tasks neu bauen (kein FK auf
//      columns mehr), umbenennen, Indizes, DROP TABLE columns, schema_version = 3
//   7. Nachpruefung: Task-/Dependency-Zahlen, PRAGMA foreign_key_check
//   8. Bericht (liegt beim Aufrufer, siehe cli/commands/migrate.ts)
//
// Bewusst NICHT ueber db.ts::openDb() geoeffnet — der Schema-Guard dort
// (assertSchemaNotStale) wuerde ein v2-Board sofort ablehnen. 'kanban migrate'
// ist explizit von diesem Guard ausgenommen (Plan Abschnitt 2.2).
import { Database } from "bun:sqlite";
import { closeSync, existsSync, fsyncSync, openSync, renameSync, writeSync } from "node:fs";
import type { ColumnConfig } from "./types.ts";
import { createTaskIndexes, createTransitionsTable, TASKS_TABLE_COLUMNS_DDL } from "./db.ts";
import {
  deriveColumnConfigs,
  MigrationAbortedError,
  precheckMigration,
  readRawConfig,
  TARGET_SCHEMA_VERSION,
  type LegacyColumnRow,
  type MigrationPrecheck,
} from "./migrate-v3-precheck.ts";

// Re-Export: Die Aufteilung in zwei Dateien ist ein internes
// Implementierungsdetail (Dateigrenze, Single Responsibility) — CLI und Tests
// importieren weiterhin nur aus 'migrate-v3.ts'. TARGET_SCHEMA_VERSION zusaetzlich
// re-exportiert seit P0-6: export-service.ts braucht dieselbe Zielversion fuer
// den v2-Import, ohne eine zweite Quelle der Wahrheit anzulegen.
export { deriveColumnConfigs, MigrationAbortedError, precheckMigration, TARGET_SCHEMA_VERSION };
export type { LegacyColumnRow, MigrationPrecheck };

export interface MigrationReport {
  status: "already-migrated" | "dry-run" | "migrated";
  taskCount: number;
  dependencyCount: number;
  columnCount: number;
  entryColumnIds: string[];
  backupPath: string | null;
}

// --- Orchestrierung ---
export function migrateToV3(
  dbPath: string,
  configPath: string,
  options?: { dryRun?: boolean },
): MigrationReport {
  const dryRun = options?.dryRun ?? false;

  // Vorpruefung ausschliesslich read-only — garantiert, dass ein --dry-run
  // (und auch der Vorlauf des echten Laufs) die Datei nicht anfasst.
  const readonlyDb = new Database(dbPath, { readonly: true });
  let pre: MigrationPrecheck;
  try {
    pre = precheckMigration(readonlyDb, configPath);
  } finally {
    readonlyDb.close();
  }

  if (pre.alreadyMigrated) {
    return {
      status: "already-migrated",
      taskCount: pre.taskCount,
      dependencyCount: pre.dependencyCount,
      columnCount: 0,
      entryColumnIds: [],
      backupPath: null,
    };
  }

  const columns = deriveColumnConfigs(pre.legacyColumns);
  const entryColumnIds = columns.filter((c) => c.allowEntry).map((c) => c.id);

  if (dryRun) {
    return {
      status: "dry-run",
      taskCount: pre.taskCount,
      dependencyCount: pre.dependencyCount,
      columnCount: columns.length,
      entryColumnIds,
      backupPath: null,
    };
  }

  const db = new Database(dbPath);
  try {
    db.run("PRAGMA busy_timeout = 5000");

    // Schritt 3: Backup — IMMER, unabhaengig davon ob Schritt 4 schon einmal
    // gelaufen ist. Ein zweiter Lauf darf ein bestehendes Backup nie zerstoeren.
    const backupPath = backupDatabase(db, dbPath);

    // Schritt 4: config.json schreiben — uebersprungen, wenn ein abgebrochener
    // Vorlauf sie schon geschrieben hat (Wiederaufsetzbarkeit).
    if (!pre.configHasColumnsAlready) {
      writeConfigAtomic(configPath, {
        name: pre.configName,
        createdAt: pre.configCreatedAt,
        schemaVersion: TARGET_SCHEMA_VERSION,
        columns,
      });
    }

    // Schritt 5: zuruecklesen und verifizieren. Laeuft IMMER, auch wenn
    // Schritt 4 uebersprungen wurde — die DB ist hier noch unberuehrt.
    verifyWrittenConfig(configPath, columns);

    // Schritt 6: die eine DB-Transaktion.
    migrateSchemaTransactionally(db, pre.taskCount);

    // Schritt 7: Nachpruefung.
    verifyPostMigration(db, { taskCount: pre.taskCount, dependencyCount: pre.dependencyCount });

    return {
      status: "migrated",
      taskCount: pre.taskCount,
      dependencyCount: pre.dependencyCount,
      columnCount: columns.length,
      entryColumnIds,
      backupPath,
    };
  } finally {
    db.close();
  }
}

// --- Schritt 3: Backup ---
function backupDatabase(db: Database, dbPath: string): string {
  let backupPath = `${dbPath}.bak-v2`;
  if (existsSync(backupPath)) {
    // Ein zweiter Lauf darf das erste Backup nie zerstoeren — das ist der
    // Fall, in dem man es am dringendsten braucht.
    backupPath = `${dbPath}.bak-v2.${Date.now()}`;
  }
  // VACUUM INTO statt Datei-Kopie: eine Kopie waere bei aktivem WAL
  // unvollstaendig, juengste Transaktionen stehen im '-wal', nicht in der '.db'.
  db.run("VACUUM INTO ?", [backupPath]);
  return backupPath;
}

// --- Schritt 4: config.json atomar schreiben ---
interface WritableConfig {
  name: string;
  createdAt: string;
  schemaVersion: number;
  columns: ColumnConfig[];
}

function writeConfigAtomic(configPath: string, config: WritableConfig): void {
  const tmpPath = `${configPath}.tmp`;
  const fd = openSync(tmpPath, "w");
  try {
    writeSync(fd, JSON.stringify(config, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, configPath);
}

// --- Schritt 5: zurueckgelesene config.json verifizieren ---
function verifyWrittenConfig(configPath: string, expectedColumns: ColumnConfig[]): void {
  const raw = readRawConfig(configPath);
  const columns = raw.columns;

  if (!Array.isArray(columns)) {
    throw new MigrationAbortedError(`config.json hat nach dem Schreiben kein 'columns'-Array: ${configPath}`);
  }
  if (columns.length !== expectedColumns.length) {
    throw new MigrationAbortedError(
      `config.json hat ${columns.length} Spalte(n) geschrieben, erwartet ${expectedColumns.length}. ` +
      "Abbruch, die DB ist noch unberuehrt.",
    );
  }

  for (let i = 0; i < expectedColumns.length; i++) {
    const written = columns[i] as Record<string, unknown>;
    const expected = expectedColumns[i]!;
    if ("position" in written) {
      throw new MigrationAbortedError(
        `config.json Spalte '${expected.id}' enthaelt ein 'position'-Feld — das darf nicht sein (ADR 0001).`,
      );
    }
    if (
      written.id !== expected.id ||
      written.name !== expected.name ||
      written.wipLimit !== expected.wipLimit ||
      written.allowEntry !== expected.allowEntry ||
      written.isTerminal !== expected.isTerminal
    ) {
      throw new MigrationAbortedError(
        `config.json Spalte an Index ${i} weicht von der DB ab (erwartet '${expected.id}'). ` +
        "Abbruch, die DB ist noch unberuehrt.",
      );
    }
  }

  const terminalCount = expectedColumns.filter((c) => c.isTerminal).length;
  if (terminalCount !== 1) {
    throw new MigrationAbortedError("config.json hat nicht genau eine Terminal-Spalte. Abbruch.");
  }
  const entryCount = expectedColumns.filter((c) => c.allowEntry).length;
  if (entryCount < 1) {
    throw new MigrationAbortedError("config.json hat keine Eintrittsspalte (allowEntry: true). Abbruch.");
  }
}

// --- Schritt 6: die eine DB-Transaktion ---
function migrateSchemaTransactionally(db: Database, expectedTaskCount: number): void {
  // PRAGMA foreign_keys kann SQLite zufolge nicht innerhalb einer offenen
  // Transaktion umgeschaltet werden — deshalb ausserhalb von BEGIN/COMMIT.
  // OHNE dieses OFF wuerde 'DROP TABLE tasks' per Cascade die gesamte
  // dependencies-Tabelle mit wegreissen (R-1, die groesste Falle dieser Migration).
  db.run("PRAGMA foreign_keys = OFF");
  try {
    const runTransactionally = db.transaction(() => {
      // a) transitions-Tabelle + Index (Reihenfolge wie in den Task-Notes)
      createTransitionsTable(db);

      // b)+c) tasks_new ohne columns-FK, mit priority/due_date; Daten kopieren
      db.run(`CREATE TABLE tasks_new (${TASKS_TABLE_COLUMNS_DDL})`);
      db.run(`
        INSERT INTO tasks_new (
          id, title, description, column_id, created_by, assigned_to, labels,
          created_at, updated_at, archived, version, position, priority, due_date
        )
        SELECT
          id, title, description, column_id, created_by, assigned_to, labels,
          created_at, updated_at, archived, version, position, NULL, NULL
        FROM tasks
      `);

      // d) Zeilenzahl pruefen — bei Abweichung wirft diese Funktion, db.transaction()
      // rollt automatisch zurueck (empirisch verifiziert).
      const newCount = (db.query("SELECT COUNT(*) as c FROM tasks_new").get() as { c: number }).c;
      if (newCount !== expectedTaskCount) {
        throw new MigrationAbortedError(
          `Tabellen-Neubau: ${newCount} Tasks kopiert, erwartet ${expectedTaskCount}. ` +
          "Transaktion wird zurueckgerollt, es wurde nichts committet.",
        );
      }

      // e) umbenennen
      db.run("DROP TABLE tasks");
      db.run("ALTER TABLE tasks_new RENAME TO tasks");

      // f) Indizes neu anlegen
      createTaskIndexes(db);

      // g) columns-Tabelle entfaellt (ADR 0001)
      db.run("DROP TABLE columns");

      // h) Schema-Version
      db.run(`UPDATE schema_version SET version = ${TARGET_SCHEMA_VERSION}`);
    });

    runTransactionally();
  } finally {
    db.run("PRAGMA foreign_keys = ON");
  }
}

// --- Schritt 7: Nachpruefung ---
function verifyPostMigration(db: Database, expected: { taskCount: number; dependencyCount: number }): void {
  const taskCount = (db.query("SELECT COUNT(*) as c FROM tasks").get() as { c: number }).c;
  const dependencyCount = (db.query("SELECT COUNT(*) as c FROM dependencies").get() as { c: number }).c;

  if (taskCount !== expected.taskCount) {
    throw new MigrationAbortedError(
      `Nach der Migration: ${taskCount} Tasks in der DB, vor der Migration waren es ${expected.taskCount}. ` +
      "Die Transaktion wurde bereits committet — Board manuell mit dem Backup pruefen.",
    );
  }
  if (dependencyCount !== expected.dependencyCount) {
    throw new MigrationAbortedError(
      `Nach der Migration: ${dependencyCount} Dependencies in der DB, vor der Migration waren es ` +
      `${expected.dependencyCount}. Die Transaktion wurde bereits committet — Board manuell mit dem Backup pruefen.`,
    );
  }

  const fkViolations = db.query("PRAGMA foreign_key_check").all();
  if (fkViolations.length > 0) {
    throw new MigrationAbortedError(
      `PRAGMA foreign_key_check meldet ${fkViolations.length} Verletzung(en) nach der Migration. ` +
      "Die Transaktion wurde bereits committet — Board manuell mit dem Backup pruefen.",
    );
  }
}
