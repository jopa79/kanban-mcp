// Tests fuer src/cli/formatters.ts. Bisher ungetestet (kein CLI-Kommando im
// Repo hat eine eigene Testdatei -- Konvention hier ist: reine Funktionen
// testen, Command-Actions (console.log/process.exit) nicht). formatStatus()
// ist eine reine Funktion und damit direkt testbar.
import { test, expect, describe } from "bun:test";
import { formatStatus } from "../src/cli/formatters.ts";

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

  test("total im Kopf ist genau das, was der Aufrufer uebergibt -- formatStatus rechnet nicht selbst", () => {
    // Waisen in 'total' einzurechnen ist Verantwortung des Aufrufers
    // (status.ts), nicht von formatStatus selbst (Plan/Kanban-Task P1-6).
    const out = formatStatus("Board", columns, 5, 2);
    expect(out).toContain("(5 Tasks)");
  });
});
