// Tests fuer die Schema-v2 -> v3 Migration (P0-4). Riskanteste Operation des
// Projekts: irreversible Umformung fremder Produktivdaten. Siehe Plan
// Abschnitt 2.3 und Kanban-Task FOnChTsCvh8r fuer die verbindliche Reihenfolge.
import { test, expect, describe, afterEach } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { Database } from "bun:sqlite";
import {
  createLegacyV2Board,
  insertLegacyTask,
  type LegacyBoardContext,
} from "./helpers.ts";
import {
  migrateToV3,
  precheckMigration,
  deriveColumnConfigs,
  MigrationAbortedError,
  type LegacyColumnRow,
} from "../src/core/migrate-v3.ts";

describe("precheckMigration", () => {
  let ctx: LegacyBoardContext;
  afterEach(() => ctx?.cleanup());

  test("liest Version, Spalten, Task- und Dependency-Zahlen aus einem v2-Board", () => {
    ctx = createLegacyV2Board();
    insertLegacyTask(ctx.db, { id: "t1", title: "A", columnId: "todo" });
    insertLegacyTask(ctx.db, { id: "t2", title: "B", columnId: "in-progress" });
    ctx.db.run("INSERT INTO dependencies (task_id, depends_on_id) VALUES (?, ?)", ["t2", "t1"]);

    const pre = precheckMigration(ctx.db, ctx.configPath);

    expect(pre.currentVersion).toBe(2);
    expect(pre.alreadyMigrated).toBe(false);
    expect(pre.taskCount).toBe(2);
    expect(pre.dependencyCount).toBe(1);
    expect(pre.legacyColumns.map((c) => c.id)).toEqual(["backlog", "todo", "in-progress", "review", "done"]);
    expect(pre.configHasColumnsAlready).toBe(false);
  });

  test("zaehlt Waisen-Tasks (column_id nicht in columns)", () => {
    ctx = createLegacyV2Board();
    insertLegacyTask(ctx.db, { id: "t1", title: "A", columnId: "todo" });
    insertLegacyTask(ctx.db, { id: "t2", title: "Waise", columnId: "geloescht", orphan: true });

    const pre = precheckMigration(ctx.db, ctx.configPath);
    expect(pre.orphanTaskCount).toBe(1);
    expect(pre.taskCount).toBe(2);
  });

  test("meldet alreadyMigrated bei Schema-Version 3", () => {
    ctx = createLegacyV2Board();
    ctx.db.run("UPDATE schema_version SET version = 3");

    const pre = precheckMigration(ctx.db, ctx.configPath);
    expect(pre.alreadyMigrated).toBe(true);
  });

  test("wirft bei Schema-Version, die weder 2 noch 3 ist", () => {
    ctx = createLegacyV2Board();
    ctx.db.run("UPDATE schema_version SET version = 1");

    expect(() => precheckMigration(ctx.db, ctx.configPath)).toThrow(MigrationAbortedError);
  });

  test("wirft ohne Terminal-Spalte", () => {
    ctx = createLegacyV2Board({
      columns: [
        { id: "backlog", name: "Backlog", position: 0 },
        { id: "todo", name: "Todo", position: 1 },
      ],
    });
    expect(() => precheckMigration(ctx.db, ctx.configPath)).toThrow(/Terminal-Spalte|is_terminal/i);
  });

  test("wirft bei zwei Terminal-Spalten", () => {
    ctx = createLegacyV2Board({
      columns: [
        { id: "backlog", name: "Backlog", position: 0 },
        { id: "done1", name: "Done1", position: 1, isTerminal: true },
        { id: "done2", name: "Done2", position: 2, isTerminal: true },
      ],
    });
    expect(() => precheckMigration(ctx.db, ctx.configPath)).toThrow(/Terminal-Spalte/i);
  });

  test("erkennt config.json, die bereits 'columns' enthaelt (abgebrochener Vorlauf)", () => {
    ctx = createLegacyV2Board();
    writeFileSync(
      ctx.configPath,
      JSON.stringify({
        name: "Legacy Board",
        createdAt: "2026-01-01T00:00:00.000Z",
        schemaVersion: 3,
        columns: deriveColumnConfigs(
          ctx.db.query("SELECT * FROM columns ORDER BY position ASC").all() as LegacyColumnRow[],
        ),
      }),
    );

    const pre = precheckMigration(ctx.db, ctx.configPath);
    expect(pre.configHasColumnsAlready).toBe(true);
  });
});

describe("deriveColumnConfigs", () => {
  test("uebersetzt position -> Array-Reihenfolge, laesst 'position' weg", () => {
    const cols = deriveColumnConfigs([
      { id: "backlog", name: "Backlog", position: 0, wip_limit: 0, is_terminal: 0 },
      { id: "todo", name: "Todo", position: 1, wip_limit: 0, is_terminal: 0 },
      { id: "done", name: "Done", position: 2, wip_limit: 0, is_terminal: 1 },
    ]);

    expect(cols.map((c) => c.id)).toEqual(["backlog", "todo", "done"]);
    for (const c of cols) {
      expect(c).not.toHaveProperty("position");
    }
  });

  test("erste zwei Spalten (nach position) werden Eintrittsspalten, Rest nicht", () => {
    const cols = deriveColumnConfigs([
      { id: "backlog", name: "Backlog", position: 0, wip_limit: 0, is_terminal: 0 },
      { id: "todo", name: "Todo", position: 1, wip_limit: 0, is_terminal: 0 },
      { id: "in-progress", name: "In Progress", position: 2, wip_limit: 3, is_terminal: 0 },
      { id: "done", name: "Done", position: 3, wip_limit: 0, is_terminal: 1 },
    ]);

    expect(cols.filter((c) => c.allowEntry).map((c) => c.id)).toEqual(["backlog", "todo"]);
  });

  test("haelt Reihenfolge bei lueckenhaften position-Werten (0, 2, 7) korrekt ein", () => {
    const cols = deriveColumnConfigs([
      { id: "a", name: "A", position: 0, wip_limit: 0, is_terminal: 0 },
      { id: "b", name: "B", position: 2, wip_limit: 0, is_terminal: 0 },
      { id: "c", name: "C", position: 7, wip_limit: 0, is_terminal: 1 },
    ]);

    // deriveColumnConfigs verlaesst sich auf die Aufrufreihenfolge (bereits
    // per ORDER BY position ASC sortiert) -- Luecken selbst sind hier kein Thema
    // mehr, nur noch die Reihenfolge.
    expect(cols.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(cols.map((c) => c.allowEntry)).toEqual([true, true, false]);
  });

  test("uebernimmt wipLimit und isTerminal 1:1", () => {
    const cols = deriveColumnConfigs([
      { id: "wip", name: "WIP", position: 0, wip_limit: 5, is_terminal: 0 },
      { id: "done", name: "Done", position: 1, wip_limit: 0, is_terminal: 1 },
    ]);
    expect(cols[0]!.wipLimit).toBe(5);
    expect(cols[1]!.isTerminal).toBe(true);
  });
});

describe("migrateToV3", () => {
  let ctx: LegacyBoardContext;
  afterEach(() => ctx?.cleanup());

  test("migriert ein einfaches v2-Board vollstaendig", () => {
    ctx = createLegacyV2Board();
    insertLegacyTask(ctx.db, { id: "t1", title: "A", columnId: "todo" });
    insertLegacyTask(ctx.db, { id: "t2", title: "B", columnId: "in-progress" });
    insertLegacyTask(ctx.db, { id: "t3", title: "C (archiviert)", columnId: "done", archived: true });
    ctx.db.run("INSERT INTO dependencies (task_id, depends_on_id) VALUES (?, ?)", ["t2", "t1"]);
    ctx.db.close();

    const result = migrateToV3(ctx.dbPath, ctx.configPath);

    expect(result.status).toBe("migrated");
    expect(result.taskCount).toBe(3);
    expect(result.dependencyCount).toBe(1);
    expect(result.columnCount).toBe(5);
    expect(result.backupPath).not.toBeNull();

    const db = new Database(ctx.dbPath, { readonly: true });
    const version = db.query("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(3);

    const tables = db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).not.toContain("columns");
    expect(tables.map((t) => t.name)).toContain("transitions");

    const taskCount = db.query("SELECT COUNT(*) as c FROM tasks").get() as { c: number };
    expect(taskCount.c).toBe(3);
    const depCount = db.query("SELECT COUNT(*) as c FROM dependencies").get() as { c: number };
    expect(depCount.c).toBe(1);

    const fkViolations = db.query("PRAGMA foreign_key_check").all();
    expect(fkViolations).toEqual([]);

    db.close();

    const config = JSON.parse(readFileSync(ctx.configPath, "utf-8"));
    expect(config.columns.map((c: { id: string }) => c.id)).toEqual([
      "backlog", "todo", "in-progress", "review", "done",
    ]);
    expect(config.schemaVersion).toBe(3);
    for (const col of config.columns) {
      expect(col).not.toHaveProperty("position");
    }
  });

  test("Dependency-Zahl bleibt exakt erhalten (R-1: kein Cascade-Verlust beim Tabellen-Neubau)", () => {
    ctx = createLegacyV2Board();
    for (let i = 0; i < 5; i++) {
      insertLegacyTask(ctx.db, { id: `t${i}`, title: `Task ${i}`, columnId: "todo" });
    }
    // Mehrere Dependencies, ueberkreuz
    ctx.db.run("INSERT INTO dependencies (task_id, depends_on_id) VALUES (?, ?)", ["t1", "t0"]);
    ctx.db.run("INSERT INTO dependencies (task_id, depends_on_id) VALUES (?, ?)", ["t2", "t0"]);
    ctx.db.run("INSERT INTO dependencies (task_id, depends_on_id) VALUES (?, ?)", ["t2", "t1"]);
    ctx.db.run("INSERT INTO dependencies (task_id, depends_on_id) VALUES (?, ?)", ["t3", "t2"]);
    ctx.db.run("INSERT INTO dependencies (task_id, depends_on_id) VALUES (?, ?)", ["t4", "t3"]);
    const depCountBefore = (ctx.db.query("SELECT COUNT(*) as c FROM dependencies").get() as { c: number }).c;
    expect(depCountBefore).toBe(5);
    ctx.db.close();

    const result = migrateToV3(ctx.dbPath, ctx.configPath);
    expect(result.dependencyCount).toBe(5);

    const db = new Database(ctx.dbPath, { readonly: true });
    const depCountAfter = (db.query("SELECT COUNT(*) as c FROM dependencies").get() as { c: number }).c;
    db.close();
    expect(depCountAfter).toBe(5);
  });

  test("Spaltenreihenfolge in config.json entspricht der alten position-Ordnung, auch bei Luecken (0, 2, 7)", () => {
    ctx = createLegacyV2Board({
      columns: [
        { id: "a", name: "A-Spalte", position: 7 },
        { id: "b", name: "B-Spalte", position: 0 },
        { id: "c", name: "C-Spalte", position: 2, isTerminal: true },
      ],
    });
    ctx.db.close();

    migrateToV3(ctx.dbPath, ctx.configPath);

    const config = JSON.parse(readFileSync(ctx.configPath, "utf-8"));
    // b (position 0) -> c (position 2) -> a (position 7)
    expect(config.columns.map((c: { id: string }) => c.id)).toEqual(["b", "c", "a"]);
    for (const col of config.columns) {
      expect(col).not.toHaveProperty("position");
    }
  });

  test("Board ohne Terminal-Spalte: Abbruch, DB und config.json bleiben unberuehrt", () => {
    ctx = createLegacyV2Board({
      columns: [
        { id: "backlog", name: "Backlog", position: 0 },
        { id: "todo", name: "Todo", position: 1 },
      ],
    });
    ctx.db.close();
    const configBefore = readFileSync(ctx.configPath, "utf-8");

    expect(() => migrateToV3(ctx.dbPath, ctx.configPath)).toThrow(MigrationAbortedError);

    expect(readFileSync(ctx.configPath, "utf-8")).toBe(configBefore);
    const db = new Database(ctx.dbPath, { readonly: true });
    const version = db.query("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(2);
    const stillHasColumns = db.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='columns'"
    ).get();
    expect(stillHasColumns).not.toBeNull();
    db.close();
  });

  test("Board mit zwei Terminal-Spalten: Abbruch mit Erklaerung", () => {
    ctx = createLegacyV2Board({
      columns: [
        { id: "backlog", name: "Backlog", position: 0 },
        { id: "done1", name: "Done1", position: 1, isTerminal: true },
        { id: "done2", name: "Done2", position: 2, isTerminal: true },
      ],
    });
    ctx.db.close();

    expect(() => migrateToV3(ctx.dbPath, ctx.configPath)).toThrow(/Terminal-Spalte/i);
  });

  test("Task in nicht existierender Spalte bleibt nach der Migration erhalten", () => {
    ctx = createLegacyV2Board();
    insertLegacyTask(ctx.db, { id: "t1", title: "Normal", columnId: "todo" });
    insertLegacyTask(ctx.db, { id: "t2", title: "Waise", columnId: "geloescht", orphan: true });
    ctx.db.close();

    const result = migrateToV3(ctx.dbPath, ctx.configPath);
    expect(result.taskCount).toBe(2);

    const db = new Database(ctx.dbPath, { readonly: true });
    const orphan = db.query("SELECT * FROM tasks WHERE id = ?").get("t2") as { column_id: string } | null;
    db.close();
    expect(orphan).not.toBeNull();
    expect(orphan!.column_id).toBe("geloescht");
  });

  test("zweimal migrieren: zweiter Lauf meldet 'bereits v3', Daten unveraendert", () => {
    ctx = createLegacyV2Board();
    insertLegacyTask(ctx.db, { id: "t1", title: "A", columnId: "todo" });
    ctx.db.close();

    const first = migrateToV3(ctx.dbPath, ctx.configPath);
    expect(first.status).toBe("migrated");

    const second = migrateToV3(ctx.dbPath, ctx.configPath);
    expect(second.status).toBe("already-migrated");
    expect(second.taskCount).toBe(1);

    const db = new Database(ctx.dbPath, { readonly: true });
    const taskCount = db.query("SELECT COUNT(*) as c FROM tasks").get() as { c: number };
    db.close();
    expect(taskCount.c).toBe(1);
  });

  test("Abbruch nach Schritt 4 simulieren: config.json hat bereits 'columns', DB noch v2 -> naechster Lauf laeuft durch", () => {
    ctx = createLegacyV2Board();
    insertLegacyTask(ctx.db, { id: "t1", title: "A", columnId: "todo" });

    // Simuliert: ein vorheriger Lauf hat config.json bereits geschrieben (Schritt 4),
    // ist aber vor Schritt 6 (DB-Transaktion) abgebrochen.
    const legacyCols = ctx.db.query("SELECT * FROM columns ORDER BY position ASC").all() as LegacyColumnRow[];
    ctx.db.close();
    const preConfig = JSON.parse(readFileSync(ctx.configPath, "utf-8"));
    writeFileSync(
      ctx.configPath,
      JSON.stringify({
        ...preConfig,
        schemaVersion: 3,
        columns: deriveColumnConfigs(legacyCols),
      }),
    );

    const result = migrateToV3(ctx.dbPath, ctx.configPath);
    expect(result.status).toBe("migrated");
    expect(result.taskCount).toBe(1);

    const db = new Database(ctx.dbPath, { readonly: true });
    const version = db.query("SELECT version FROM schema_version").get() as { version: number };
    db.close();
    expect(version.version).toBe(3);
  });

  test("Backup ist ein oeffenbares v2-Board mit allen Tasks", () => {
    ctx = createLegacyV2Board();
    insertLegacyTask(ctx.db, { id: "t1", title: "A", columnId: "todo" });
    insertLegacyTask(ctx.db, { id: "t2", title: "B", columnId: "done" });
    ctx.db.close();

    const result = migrateToV3(ctx.dbPath, ctx.configPath);
    expect(result.backupPath).not.toBeNull();
    expect(existsSync(result.backupPath!)).toBe(true);

    const backupDb = new Database(result.backupPath!, { readonly: true });
    const version = backupDb.query("SELECT version FROM schema_version").get() as { version: number };
    expect(version.version).toBe(2);
    const taskCount = backupDb.query("SELECT COUNT(*) as c FROM tasks").get() as { c: number };
    expect(taskCount.c).toBe(2);
    const hasColumnsTable = backupDb.query(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='columns'"
    ).get();
    expect(hasColumnsTable).not.toBeNull();
    backupDb.close();
  });

  test("existierendes board.db.bak-v2 wird nie ueberschrieben, sondern zeitgestempelt ergaenzt", () => {
    ctx = createLegacyV2Board();
    insertLegacyTask(ctx.db, { id: "t1", title: "A", columnId: "todo" });
    ctx.db.close();

    const existingBackupPath = `${ctx.dbPath}.bak-v2`;
    writeFileSync(existingBackupPath, "PLATZHALTER-NICHT-ANFASSEN");

    const result = migrateToV3(ctx.dbPath, ctx.configPath);

    // Der alte Platzhalter darf nicht ueberschrieben worden sein.
    expect(readFileSync(existingBackupPath, "utf-8")).toBe("PLATZHALTER-NICHT-ANFASSEN");
    // Es muss ein NEUER, zeitgestempelter Backup-Pfad entstanden sein.
    expect(result.backupPath).not.toBeNull();
    expect(result.backupPath).not.toBe(existingBackupPath);
    expect(result.backupPath!.startsWith(existingBackupPath)).toBe(true);
    expect(existsSync(result.backupPath!)).toBe(true);
  });

  test("--dry-run schreibt nichts (Dateizeitstempel und Inhalt unveraendert)", () => {
    ctx = createLegacyV2Board();
    insertLegacyTask(ctx.db, { id: "t1", title: "A", columnId: "todo" });
    ctx.db.close();

    const configBefore = readFileSync(ctx.configPath, "utf-8");
    const dbMtimeBefore = statSync(ctx.dbPath).mtimeMs;
    const backupPath = `${ctx.dbPath}.bak-v2`;

    const result = migrateToV3(ctx.dbPath, ctx.configPath, { dryRun: true });

    expect(result.status).toBe("dry-run");
    expect(result.taskCount).toBe(1);
    expect(result.columnCount).toBe(5);
    expect(readFileSync(ctx.configPath, "utf-8")).toBe(configBefore);
    expect(statSync(ctx.dbPath).mtimeMs).toBe(dbMtimeBefore);
    expect(existsSync(backupPath)).toBe(false);

    const db = new Database(ctx.dbPath, { readonly: true });
    const version = db.query("SELECT version FROM schema_version").get() as { version: number };
    db.close();
    expect(version.version).toBe(2);
  });

  test("dry-run gegen ein bereits migriertes Board meldet already-migrated ohne Schreibvorgang", () => {
    ctx = createLegacyV2Board();
    insertLegacyTask(ctx.db, { id: "t1", title: "A", columnId: "todo" });
    ctx.db.close();
    migrateToV3(ctx.dbPath, ctx.configPath);

    const result = migrateToV3(ctx.dbPath, ctx.configPath, { dryRun: true });
    expect(result.status).toBe("already-migrated");
  });
});
