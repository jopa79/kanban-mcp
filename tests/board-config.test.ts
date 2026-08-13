// Tests fuer validateBoardConfig (types.ts) und loadBoardConfig (db.ts) — Schema v3
import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateBoardConfig,
  ORPHAN_COLUMN_ID,
  RESERVED_COLUMN_IDS,
  type ColumnConfig,
} from "../src/core/types.ts";
import { loadBoardConfig } from "../src/core/db.ts";

// Gueltige Referenz-Config (Zielformat aus K-1)
function validColumns(): ColumnConfig[] {
  return [
    { id: "backlog", name: "Backlog", wipLimit: 0, allowEntry: true, isTerminal: false },
    { id: "todo", name: "Todo", wipLimit: 0, allowEntry: true, isTerminal: false },
    { id: "in-progress", name: "In Progress", wipLimit: 3, allowEntry: false, isTerminal: false },
    { id: "review", name: "Review", wipLimit: 0, allowEntry: false, isTerminal: false },
    { id: "done", name: "Done", wipLimit: 0, allowEntry: false, isTerminal: true },
  ];
}

function validRaw(overrides: Record<string, unknown> = {}): unknown {
  return {
    name: "Test Board",
    createdAt: "2026-01-01T00:00:00.000Z",
    schemaVersion: 3,
    columns: validColumns(),
    ...overrides,
  };
}

describe("validateBoardConfig", () => {
  test("akzeptiert eine gueltige Config", () => {
    const config = validateBoardConfig(validRaw());
    expect(config.columns).toHaveLength(5);
    expect(config.schemaVersion).toBe(3);
    expect(config.name).toBe("Test Board");
  });

  test("wirft Fehler wenn 'columns' fehlt", () => {
    const raw = validRaw();
    delete (raw as Record<string, unknown>).columns;
    expect(() => validateBoardConfig(raw)).toThrow(/columns/);
  });

  test("wirft Fehler wenn 'columns' leer ist", () => {
    expect(() => validateBoardConfig(validRaw({ columns: [] }))).toThrow(/mindestens eine/i);
  });

  test("wirft Fehler bei zwei Terminal-Spalten", () => {
    const cols = validColumns();
    cols[1]!.isTerminal = true; // todo zusaetzlich terminal
    expect(() => validateBoardConfig(validRaw({ columns: cols }))).toThrow(/isTerminal/);
  });

  test("wirft Fehler wenn keine Spalte isTerminal ist", () => {
    const cols = validColumns().map((c) => ({ ...c, isTerminal: false }));
    expect(() => validateBoardConfig(validRaw({ columns: cols }))).toThrow(/isTerminal/);
  });

  test("wirft Fehler wenn keine Spalte allowEntry hat", () => {
    const cols = validColumns().map((c) => ({ ...c, allowEntry: false }));
    expect(() => validateBoardConfig(validRaw({ columns: cols }))).toThrow(/allowEntry/);
  });

  test("wirft Fehler bei doppelter Spalten-id", () => {
    const cols = validColumns();
    cols[1]!.id = "backlog"; // Duplikat von cols[0]
    expect(() => validateBoardConfig(validRaw({ columns: cols }))).toThrow(/backlog/);
  });

  test("wirft Fehler wenn eine Spalte ein 'position'-Feld enthaelt", () => {
    const cols: Array<ColumnConfig & { position?: number }> = validColumns();
    cols[2]!.position = 2;
    expect(() => validateBoardConfig(validRaw({ columns: cols }))).toThrow(/position/);
  });

  // Die Waisen-Sammelspalte ist virtuell und wird der Anzeige-Liste zur Laufzeit
  // angehaengt. Traege eine echte Spalte dieselbe id, staenden zwei Eintraege mit
  // gleicher id in der Liste — in board-view.tsx eine React-Key-Kollision.
  test("wirft Fehler bei reservierter Spalten-id (Waisen-Sammelspalte)", () => {
    const cols = validColumns();
    cols[1]!.id = ORPHAN_COLUMN_ID;
    expect(() => validateBoardConfig(validRaw({ columns: cols }))).toThrow(/reservierte/);
  });

  test("lehnt jede reservierte id ab, nicht nur die erste", () => {
    // Ohne diese Zusicherung waere der Test bei leerer Liste stillschweigend gruen.
    expect(RESERVED_COLUMN_IDS.length).toBeGreaterThan(0);
    for (const reserved of RESERVED_COLUMN_IDS) {
      const cols = validColumns();
      cols[0]!.id = reserved;
      expect(() => validateBoardConfig(validRaw({ columns: cols }))).toThrow(/reservierte/);
    }
  });

  test("die Fehlermeldung nennt die betroffene id", () => {
    const cols = validColumns();
    cols[3]!.id = ORPHAN_COLUMN_ID;
    expect(() => validateBoardConfig(validRaw({ columns: cols }))).toThrow(
      new RegExp(ORPHAN_COLUMN_ID),
    );
  });
});

describe("loadBoardConfig", () => {
  const dirs: string[] = [];
  afterEach(() => {
    dirs.forEach((d) => rmSync(d, { recursive: true, force: true }));
    dirs.length = 0;
  });

  function tmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "kanban-config-test-"));
    dirs.push(dir);
    return dir;
  }

  test("laedt und validiert eine gueltige config.json", () => {
    const dir = tmpDir();
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify(validRaw()));

    const config = loadBoardConfig(configPath);
    expect(config.columns).toHaveLength(5);
  });

  test("wirft Fehler mit Pfad wenn Datei fehlt", () => {
    const dir = tmpDir();
    const configPath = join(dir, "config.json");
    expect(() => loadBoardConfig(configPath)).toThrow(configPath);
  });

  test("wirft Fehler mit Pfad wenn JSON ungueltig ist", () => {
    const dir = tmpDir();
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, "{ kaputt");
    expect(() => loadBoardConfig(configPath)).toThrow(configPath);
  });

  test("wirft Fehler mit Pfad wenn Validierung fehlschlaegt", () => {
    const dir = tmpDir();
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify(validRaw({ columns: [] })));
    expect(() => loadBoardConfig(configPath)).toThrow(configPath);
  });
});
