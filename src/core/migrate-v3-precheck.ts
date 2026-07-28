// Vorpruefung fuer die Schema-v2 -> v3 Migration (P0-4, Kanban-Task
// FOnChTsCvh8r). Rein lesend: bestimmt den Ist-Zustand eines Boards, leitet
// die neue Spalten-Konfiguration ab, wirft bei inkonsistenten Boards ab (kein
// Raten). Eigene Datei statt Teil von migrate-v3.ts — Single Responsibility:
// "was ist der Zustand" (hier) vs. "wie wird er veraendert" (migrate-v3.ts,
// Schritte 3-8). Wird von dort importiert und re-exportiert; Aufrufer
// (CLI, Tests) importieren weiterhin ausschliesslich aus 'migrate-v3.ts'.
import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import type { ColumnConfig } from "./types.ts";

export const TARGET_SCHEMA_VERSION = 3;
const SOURCE_SCHEMA_VERSION = 2;

// v2 kennt kein 'allowEntry'. Die ersten N Spalten in Positions-Reihenfolge
// werden zu Eintrittsspalten (P0-4-Notes). Beim Default-Board ergibt das
// 'backlog' und 'todo' — bei abweichend konfigurierten Boards ist das eine
// Annahme, die der CLI-Bericht ausweist.
const DEFAULT_ENTRY_COLUMN_COUNT = 2;

export class MigrationAbortedError extends Error {}

export interface LegacyColumnRow {
  id: string;
  name: string;
  position: number;
  wip_limit: number;
  is_terminal: number;
}

export interface MigrationPrecheck {
  currentVersion: number;
  alreadyMigrated: boolean;
  legacyColumns: LegacyColumnRow[];
  taskCount: number;
  dependencyCount: number;
  orphanTaskCount: number;
  configHasColumnsAlready: boolean;
  configName: string;
  configCreatedAt: string;
}

// --- Schritt 1+2: Vorpruefung (read-only) ---
export function precheckMigration(db: Database, configPath: string): MigrationPrecheck {
  const versionRow = db.query("SELECT version FROM schema_version").get() as { version: number } | null;
  const currentVersion = versionRow?.version ?? 0;

  if (currentVersion === TARGET_SCHEMA_VERSION) {
    const taskCount = (db.query("SELECT COUNT(*) as c FROM tasks").get() as { c: number }).c;
    const dependencyCount = (db.query("SELECT COUNT(*) as c FROM dependencies").get() as { c: number }).c;
    return {
      currentVersion,
      alreadyMigrated: true,
      legacyColumns: [],
      taskCount,
      dependencyCount,
      orphanTaskCount: 0,
      configHasColumnsAlready: true,
      configName: "",
      configCreatedAt: "",
    };
  }

  if (currentVersion !== SOURCE_SCHEMA_VERSION) {
    throw new MigrationAbortedError(
      `Board-Schema ist Version ${currentVersion}. 'kanban migrate' migriert ausschliesslich von ` +
      `Version ${SOURCE_SCHEMA_VERSION} nach ${TARGET_SCHEMA_VERSION}.`,
    );
  }

  if (!tableExists(db, "columns")) {
    throw new MigrationAbortedError(
      "Board ist auf Schema-Version 2, hat aber keine 'columns'-Tabelle. " +
      "Inkonsistenter Zustand — bitte manuell pruefen, keine automatische Annahme.",
    );
  }

  const legacyColumns = db.query("SELECT * FROM columns ORDER BY position ASC").all() as LegacyColumnRow[];
  if (legacyColumns.length === 0) {
    throw new MigrationAbortedError(
      "Board hat keine Zeilen in der 'columns'-Tabelle. Inkonsistenter Zustand — bitte manuell pruefen.",
    );
  }

  const terminalCount = legacyColumns.filter((c) => c.is_terminal === 1).length;
  if (terminalCount !== 1) {
    throw new MigrationAbortedError(
      `Board hat ${terminalCount} Terminal-Spalte(n) (is_terminal = 1), erwartet genau eine. ` +
      "Board ist bereits vor der Migration inkonsistent — kein Raten, bitte manuell pruefen.",
    );
  }

  const taskCount = (db.query("SELECT COUNT(*) as c FROM tasks").get() as { c: number }).c;
  const dependencyCount = (db.query("SELECT COUNT(*) as c FROM dependencies").get() as { c: number }).c;

  const knownColumnIds = new Set(legacyColumns.map((c) => c.id));
  const taskColumns = db.query("SELECT column_id FROM tasks").all() as Array<{ column_id: string }>;
  const orphanTaskCount = taskColumns.filter((r) => !knownColumnIds.has(r.column_id)).length;

  const rawConfig = readRawConfig(configPath);
  if (typeof rawConfig.name !== "string" || typeof rawConfig.createdAt !== "string") {
    throw new MigrationAbortedError(`config.json hat kein gueltiges 'name'/'createdAt': ${configPath}`);
  }

  return {
    currentVersion,
    alreadyMigrated: false,
    legacyColumns,
    taskCount,
    dependencyCount,
    orphanTaskCount,
    configHasColumnsAlready: Array.isArray(rawConfig.columns),
    configName: rawConfig.name,
    configCreatedAt: rawConfig.createdAt,
  };
}

// Positions-Uebersetzung (P0-4-Notes): legacyColumns MUSS bereits nach
// position sortiert sein (siehe precheckMigration: ORDER BY position ASC).
// Die Array-Reihenfolge wird zur Ordnung, das 'position'-Feld faellt weg —
// auch bei lueckenhaften Werten (0, 2, 7) bleibt nur die Reihenfolge uebrig.
export function deriveColumnConfigs(legacyColumns: LegacyColumnRow[]): ColumnConfig[] {
  return legacyColumns.map((col, index) => ({
    id: col.id,
    name: col.name,
    wipLimit: col.wip_limit,
    allowEntry: index < DEFAULT_ENTRY_COLUMN_COUNT,
    isTerminal: col.is_terminal === 1,
  }));
}

function tableExists(db: Database, name: string): boolean {
  const row = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  return row !== null;
}

// Exportiert (nicht nur intern genutzt): migrate-v3.ts braucht dieselbe
// Roh-Lese-Logik in Schritt 5 (verifyWrittenConfig), um die zurueckgelesene
// config.json zu pruefen — eine zweite Implementierung waere Drift-Risiko.
export function readRawConfig(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) {
    throw new MigrationAbortedError(`config.json fehlt: ${configPath}`);
  }
  let text: string;
  try {
    text = readFileSync(configPath, "utf-8");
  } catch {
    throw new MigrationAbortedError(`config.json nicht lesbar: ${configPath}`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new MigrationAbortedError(`config.json ist kein gueltiges JSON: ${configPath}`);
  }
}
