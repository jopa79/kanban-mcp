// Mount-Tests fuer SearchResultList (Sprung-Suchmodus, GitHub #51, Plan
// .claude/plans/tui-search-jump.md, Schritt T3). Wie bei BoardPickerList
// (tests/board-picker.test.tsx): renderToString() prueft den durch Props
// bestimmten Render-Zustand, kein ANSI, keine Tastatur-Interaktion. Deshalb
// testet diese Datei nur 'SearchResultList' (reine Darstellung), nicht
// 'SearchView' selbst (haelt State + useInput, siehe dortiger Kommentar) --
// das deckt tests/tui-search.test.ts (T4) mit einem Fake-TTY-Mount ab.
import React from "react";
import { renderToString } from "ink";
import { test, expect, describe } from "bun:test";
import { SearchResultList } from "../src/tui/search-view.tsx";
import { initLineInputState, type LineInputState } from "../src/tui/line-input.tsx";
import type { Column, Task } from "../src/core/types.ts";
import { ORPHAN_COLUMN_ID } from "../src/core/types.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    title: "Task",
    description: null,
    columnId: "todo",
    createdBy: "user",
    assignedTo: null,
    labels: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archived: false,
    version: 1,
    position: 0,
    priority: null,
    dueDate: null,
    ...overrides,
  };
}

function makeColumn(overrides: Partial<Column> = {}): Column {
  return {
    id: "todo",
    name: "Todo",
    position: 0,
    wipLimit: 0,
    allowEntry: true,
    isTerminal: false,
    ...overrides,
  };
}

const DEFAULT_COLUMNS: Column[] = [
  makeColumn({ id: "backlog", name: "Backlog", position: 0 }),
  makeColumn({ id: "todo", name: "Todo", position: 1 }),
  makeColumn({ id: "done", name: "Done", position: 2, isTerminal: true }),
];

function renderList(opts: {
  inputValue?: string;
  hits?: Task[];
  cursor?: number;
  invalidDue?: string | null;
  displayColumns?: Column[];
  columns?: Column[];
  maxVisible?: number;
}) {
  const inputState: LineInputState = initLineInputState(opts.inputValue ?? "");
  const out = renderToString(
    <SearchResultList
      inputState={inputState}
      hits={opts.hits ?? []}
      cursor={opts.cursor ?? 0}
      invalidDue={opts.invalidDue ?? null}
      displayColumns={opts.displayColumns ?? DEFAULT_COLUMNS}
      columns={opts.columns ?? DEFAULT_COLUMNS}
      maxVisible={opts.maxVisible ?? 10}
    />,
    { columns: 80 },
  );
  return out.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("SearchResultList -- kein Treffer", () => {
  test("leere Trefferliste zeigt 'Keine Treffer'", () => {
    const text = renderList({ hits: [] });
    expect(text).toContain("Keine Treffer");
  });
});

describe("SearchResultList -- ungueltiges Datum", () => {
  test("invalidDue zeigt den Hinweistext statt der Liste", () => {
    const hit = makeTask({ title: "Sollte nicht erscheinen" });
    const text = renderList({ hits: [hit], invalidDue: "morgen" });
    expect(text).toContain("Ungueltiges Datum, erwartet JJJJ-MM oder JJJJ-MM-TT");
    expect(text).not.toContain("Keine Treffer");
  });
});

describe("SearchResultList -- Trefferzeile", () => {
  test("zeigt Spaltenname und Kurz-ID (8 Zeichen)", () => {
    const hit = makeTask({ id: "abcdef12-3456-7890-abcd-ef1234567890", title: "Kanban-Task", columnId: "todo" });
    const text = renderList({ hits: [hit], displayColumns: DEFAULT_COLUMNS, columns: DEFAULT_COLUMNS });
    expect(text).toContain("Todo");
    expect(text).toContain("abcdef12");
    expect(text).toContain("Kanban-Task");
  });

  test("zeigt dueDate, falls gesetzt", () => {
    const hit = makeTask({ title: "Mit Datum", dueDate: "2026-09-03" });
    const text = renderList({ hits: [hit] });
    expect(text).toContain("2026-09-03");
  });

  test("Waise zeigt den Namen der Sammelspalte", () => {
    const orphanCol = makeColumn({ id: ORPHAN_COLUMN_ID, name: "⚠ Ohne Spalte", position: 3 });
    const displayColumns = [...DEFAULT_COLUMNS, orphanCol];
    const hit = makeTask({ title: "Verwaister Task", columnId: "geloeschte-spalte" });
    const text = renderList({ hits: [hit], displayColumns, columns: DEFAULT_COLUMNS });
    expect(text).toContain("⚠ Ohne Spalte");
  });
});

describe("SearchResultList -- Cursor-Zeichen am Zeilenanfang", () => {
  // Auflage aus Review Runde 4 (Plan Abschnitt 9): startsWith("> ") pruefen,
  // nicht bloss expect(line).toContain(">") -- ein Task-Titel kann selbst ein
  // ">" enthalten (z.B. "Backlog -> Todo" aus einer Statusmeldung). Nur das
  // sichtbare Zeichen ist per renderToString() testbar, inverse Darstellung
  // (kein ANSI im Rueckgabewert) nicht.
  test("Cursor-Zeile beginnt mit '> ', andere Zeilen mit zwei Leerzeichen", () => {
    const hits = [
      makeTask({ id: "aaaaaaaa-0000-0000-0000-000000000000", title: "Backlog -> Todo erledigt" }),
      makeTask({ id: "bbbbbbbb-0000-0000-0000-000000000000", title: "Zweiter Treffer" }),
    ];
    const text = renderList({ hits, cursor: 1 });
    const lines = text.split("\n");
    const cursorLine = lines.find((l) => l.includes("Zweiter Treffer"));
    const otherLine = lines.find((l) => l.includes("Backlog -> Todo erledigt"));
    expect(cursorLine).toBeDefined();
    expect(otherLine).toBeDefined();
    expect(cursorLine!.startsWith("> ")).toBe(true);
    expect(otherLine!.startsWith("  ")).toBe(true);
    expect(otherLine!.startsWith(">")).toBe(false);
  });
});

describe("SearchResultList -- Scroll-Fenster", () => {
  test("mehr Treffer als maxVisible zeigt den unteren Scroll-Indikator", () => {
    const hits = Array.from({ length: 5 }, (_, i) =>
      makeTask({ id: `${i}0000000-0000-0000-0000-000000000000`, title: `Task ${i}` }));
    const text = renderList({ hits, cursor: 0, maxVisible: 2 });
    expect(text).toMatch(/▼ \d+ weitere/);
  });

  test("Cursor in der Mitte zeigt oberen UND unteren Scroll-Indikator", () => {
    const hits = Array.from({ length: 7 }, (_, i) =>
      makeTask({ id: `${i}0000000-0000-0000-0000-000000000000`, title: `Task ${i}` }));
    const text = renderList({ hits, cursor: 3, maxVisible: 2 });
    expect(text).toMatch(/▲ \d+ weitere/);
    expect(text).toMatch(/▼ \d+ weitere/);
  });
});

describe("SearchResultList -- Fusszeile und Eingabezeile", () => {
  test("nennt Auswaehlen/Springen/Zurueck", () => {
    const text = renderList({});
    expect(text).toMatch(/Auswaehlen/);
    expect(text).toMatch(/Springen/);
    expect(text).toMatch(/Zurueck/);
  });

  test("zeigt den aktuellen Eingabewert", () => {
    const text = renderList({ inputValue: "kanban" });
    expect(text).toContain("kanban");
  });
});
