// Tests fuer src/cli/formatters.ts. Bisher ungetestet (kein CLI-Kommando im
// Repo hat eine eigene Testdatei -- Konvention hier ist: reine Funktionen
// testen, Command-Actions (console.log/process.exit) nicht). formatStatus()
// ist eine reine Funktion und damit direkt testbar.
import { test, expect, describe } from "bun:test";
import { formatStatus, formatBoardsList } from "../src/cli/formatters.ts";
import type { BoardOverviewEntry } from "../src/cli/board-overview.ts";

describe("formatStatus", () => {
  const columns = [
    { column: "Todo", columnId: "todo", count: 2 },
    { column: "Done", columnId: "done", count: 1 },
  ];

  test("ohne Waisen: keine 'Ohne Spalte'-Zeile", () => {
    const out = formatStatus("Board", columns, 3);
    expect(out).not.toContain("Ohne Spalte");
  });

  test("mit Waisen (P1-6): zusaetzliche Zeile mit Anzahl", () => {
    const out = formatStatus("Board", columns, 5, 2);
    expect(out).toContain("Ohne Spalte");
    expect(out).toContain("2");
  });

  test("orphanCount 0 explizit uebergeben: wie 'ohne Waisen'", () => {
    const out = formatStatus("Board", columns, 3, 0);
    expect(out).not.toContain("Ohne Spalte");
  });

  // K-5/ADR 0005: die Transitions-Zahl wird ausgewiesen, damit Wachstum
  // auffaellt. Gekappt wird in 0.2.0 bewusst nichts.
  test("ohne transitionCount: keine Transitions-Zeile", () => {
    const out = formatStatus("Board", columns, 3, 0);
    expect(out).not.toContain("Transitions");
  });

  test("mit transitionCount: Zeile mit der Anzahl", () => {
    const out = formatStatus("Board", columns, 3, 0, 47);
    expect(out).toContain("Transitions");
    expect(out).toContain("47");
  });

  test("transitionCount 0 wird angezeigt, nicht unterdrueckt", () => {
    // Anders als orphanCount: 0 Waisen sind ein Nicht-Ereignis, 0 Transitions
    // sind eine Aussage ueber ein frisches Board.
    const out = formatStatus("Board", columns, 3, 0, 0);
    expect(out).toContain("Transitions");
    expect(out).toContain("0");
  });

  test("grosse Zahlen werden gruppiert, damit die Groessenordnung ins Auge faellt", () => {
    const out = formatStatus("Board", columns, 3, 0, 12483);
    expect(out).toContain("12.483");
  });

  test("total im Kopf ist genau das, was der Aufrufer uebergibt -- formatStatus rechnet nicht selbst", () => {
    // Waisen in 'total' einzurechnen ist Verantwortung des Aufrufers
    // (status.ts), nicht von formatStatus selbst (Plan/Kanban-Task P1-6).
    const out = formatStatus("Board", columns, 5, 2);
    expect(out).toContain("(5 Tasks)");
  });
});

describe("formatBoardsList", () => {
  function entry(overrides: Partial<BoardOverviewEntry> = {}): BoardOverviewEntry {
    return {
      path: "/some/board",
      name: "Board",
      registeredAt: "2026-01-01T00:00:00.000Z",
      status: { kind: "ok", taskCount: 3 },
      ...overrides,
    };
  }

  test("leere Liste: freundliche Meldung statt leerer Tabelle", () => {
    const out = formatBoardsList([]);
    expect(out).toContain("Keine Boards registriert");
  });

  test("gesundes Board: Name, Pfad und Task-Zahl erscheinen", () => {
    const out = formatBoardsList([entry({ name: "Mein Board", path: "/x/y", status: { kind: "ok", taskCount: 7 } })]);
    expect(out).toContain("Mein Board");
    expect(out).toContain("/x/y");
    expect(out).toContain("7 Tasks");
  });

  test("missing: Warnzeile statt Task-Zahl", () => {
    const out = formatBoardsList([entry({ status: { kind: "missing" } })]);
    expect(out).toContain("Pfad existiert nicht mehr");
  });

  test("schema-outdated: nennt die tatsaechliche Version, nicht hartkodiert '2'", () => {
    const out = formatBoardsList([entry({ status: { kind: "schema-outdated", version: 2 } })]);
    expect(out).toContain("Schema v2");
    expect(out).toContain("kanban migrate");

    const outV5 = formatBoardsList([entry({ status: { kind: "schema-outdated", version: 5 } })]);
    expect(outV5).toContain("Schema v5");
  });

  test("error: Fehlermeldung erscheint in der Zeile", () => {
    const out = formatBoardsList([entry({ status: { kind: "error", message: "config.json ist kein gueltiges JSON" } })]);
    expect(out).toContain("config.json ist kein gueltiges JSON");
  });

  test("mehrere Boards: ein kaputtes verdraengt die anderen Zeilen nicht", () => {
    const out = formatBoardsList([
      entry({ name: "Gesund", status: { kind: "ok", taskCount: 1 } }),
      entry({ name: "Kaputt", status: { kind: "error", message: "boom" } }),
    ]);
    expect(out).toContain("Gesund");
    expect(out).toContain("Kaputt");
  });
});
