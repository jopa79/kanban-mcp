// Unit-Tests fuer die reine Suchlogik des Sprung-Suchmodus (GitHub #51, Plan
// .claude/plans/tui-search-jump.md, Schritt T1). Reine Funktionen, kein
// Renderer, kein useInput -- Stil wie tests/line-input.test.ts und
// tests/text-area.test.ts.
import { test, expect, describe } from "bun:test";
import {
  parseSearchQuery,
  buildSearchIndex,
  matchesQuery,
  searchTasks,
  locateTask,
  NOTES_INDEX_LIMIT,
  type SearchEntry,
} from "../src/tui/search-query.ts";
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

// Die "elf Praefixe" von "2026-09-03" -- von leer bis vollstaendig.
const FULL_DATE = "2026-09-03";
const ALL_PREFIXES = Array.from({ length: FULL_DATE.length + 1 }, (_, i) => FULL_DATE.slice(0, i));

describe("parseSearchQuery -- Grundfaelle", () => {
  test("leere Eingabe ergibt keine Terme und kein Datum", () => {
    const q = parseSearchQuery("");
    expect(q.textTerms).toEqual([]);
    expect(q.due).toEqual({ kind: "none" });
  });

  test("nur Text -- alle Tokens landen in textTerms", () => {
    const q = parseSearchQuery("kanban board");
    expect(q.textTerms).toEqual(["kanban", "board"]);
    expect(q.due).toEqual({ kind: "none" });
  });

  test("faellig: vor Text", () => {
    const q = parseSearchQuery("faellig:2026-09 Kanban");
    expect(q.due).toEqual({ kind: "prefix", value: "2026-09" });
    expect(q.textTerms).toEqual(["kanban"]);
  });

  test("faellig: nach Text", () => {
    const q = parseSearchQuery("Kanban faellig:2026-09-03");
    expect(q.due).toEqual({ kind: "prefix", value: "2026-09-03" });
    expect(q.textTerms).toEqual(["kanban"]);
  });

  test("fällig:-Schreibweise wird ebenso erkannt", () => {
    const q = parseSearchQuery("fällig:2026-09-03");
    expect(q.due).toEqual({ kind: "prefix", value: "2026-09-03" });
  });

  test("zwei Datumstoken -- das letzte gilt", () => {
    const q = parseSearchQuery("faellig:2026-01 faellig:2026-09");
    expect(q.due).toEqual({ kind: "prefix", value: "2026-09" });
  });

  test("Grossschreibung wird normalisiert", () => {
    const q = parseSearchQuery("FAELLIG:2026-09 KANBAN");
    expect(q.due).toEqual({ kind: "prefix", value: "2026-09" });
    expect(q.textTerms).toEqual(["kanban"]);
  });

  test("mehrere Leerzeichen werden wie eines behandelt", () => {
    const q = parseSearchQuery("  kanban    board  ");
    expect(q.textTerms).toEqual(["kanban", "board"]);
  });

  test("NFD-Eingabe fällig:2026-09 wird als Datumsfilter erkannt", () => {
    // "ä" als "a" + combining diaeresis (U+0308) -- NFD-Form.
    const nfd = "fällig:2026-09";
    const q = parseSearchQuery(nfd);
    expect(q.due).toEqual({ kind: "prefix", value: "2026-09" });
  });
});

describe("parseSearchQuery -- Datumszustand pending", () => {
  test("faellig: ohne Wert ergibt pending", () => {
    expect(parseSearchQuery("faellig:").due).toEqual({ kind: "pending" });
  });

  test("faellig:2026-0 ergibt pending", () => {
    expect(parseSearchQuery("faellig:2026-0").due).toEqual({ kind: "pending" });
  });

  test("faellig:2026-09- ergibt pending", () => {
    expect(parseSearchQuery("faellig:2026-09-").due).toEqual({ kind: "pending" });
  });

  test("faellig:2026-09-0 ergibt pending", () => {
    expect(parseSearchQuery("faellig:2026-09-0").due).toEqual({ kind: "pending" });
  });
});

describe("parseSearchQuery -- Datumszustand prefix", () => {
  test("faellig:2026-09 ergibt prefix", () => {
    expect(parseSearchQuery("faellig:2026-09").due).toEqual({ kind: "prefix", value: "2026-09" });
  });

  test("faellig:2026-09-03 ergibt prefix", () => {
    expect(parseSearchQuery("faellig:2026-09-03").due).toEqual({ kind: "prefix", value: "2026-09-03" });
  });
});

describe("parseSearchQuery -- Datumszustand invalid", () => {
  test("faellig:2026-13 ist invalid (Monat ausserhalb 01-12)", () => {
    const due = parseSearchQuery("faellig:2026-13").due;
    expect(due.kind).toBe("invalid");
    expect(due).toEqual({ kind: "invalid", raw: "2026-13" });
  });

  test("faellig:2026-09-32 ist invalid (Tag ausserhalb 01-31)", () => {
    const due = parseSearchQuery("faellig:2026-09-32").due;
    expect(due.kind).toBe("invalid");
  });

  test("faellig:2026-13-99 ist invalid", () => {
    const due = parseSearchQuery("faellig:2026-13-99").due;
    expect(due.kind).toBe("invalid");
  });

  test("faellig:morgen ist invalid", () => {
    const due = parseSearchQuery("faellig:morgen").due;
    expect(due.kind).toBe("invalid");
  });
});

// Regressionsbedingung aus dem Plan (Abschnitt 3 / T1): fuer JEDES der elf
// Praefixe von "2026-09-03" -- von leer bis vollstaendig -- darf der
// Datumszustand nie "invalid" sein. Das macht das "Blinken der
// Fehlermeldung beim Tippen" zur Regressionsbedingung (vier Review-Runden
// des devils-advocate, siehe Plan Abschnitt 9).
describe("parseSearchQuery -- Regression: kein Blinken beim Tippen von 2026-09-03", () => {
  test("alle elf Zwischenzustaende sind niemals invalid", () => {
    expect(ALL_PREFIXES.length).toBe(11);
    for (const prefix of ALL_PREFIXES) {
      const due = parseSearchQuery(`faellig:${prefix}`).due;
      expect(due.kind).not.toBe("invalid");
    }
  });
});

describe("buildSearchIndex", () => {
  test("Notizen werden nur fuer hasNotes === true geladen", () => {
    const calls: string[] = [];
    const tasks = [
      makeTask({ id: "a", hasNotes: true }),
      makeTask({ id: "b", hasNotes: false }),
      makeTask({ id: "c" }), // hasNotes undefined
    ];
    buildSearchIndex(tasks, (id) => {
      calls.push(id);
      return "Notiz";
    });
    expect(calls).toEqual(["a"]);
  });

  test("null-Description stoert nicht", () => {
    const tasks = [makeTask({ description: null })];
    const index = buildSearchIndex(tasks, () => null);
    expect(index[0]?.haystack).toContain("task");
  });

  test("hasNotes === true mit Loader-Ergebnis null (Datei fehlt) stoert nicht", () => {
    const task = makeTask({ hasNotes: true, title: "Alpha" });
    const index = buildSearchIndex([task], () => null);
    // haystack = [title, description ?? "", notes, id].join(" ") -- description
    // und notes sind hier leer, das ergibt drei Leerzeichen vor der ID.
    expect(index[0]?.haystack).toBe(`alpha   ${task.id}`);
  });

  test("Notiz laenger als NOTES_INDEX_LIMIT wird gekappt", () => {
    const longNote = "x".repeat(NOTES_INDEX_LIMIT + 500);
    const tasks = [makeTask({ hasNotes: true, title: "T" })];
    const index = buildSearchIndex(tasks, () => longNote);
    const xCount = (index[0]?.haystack.match(/x/g) ?? []).length;
    expect(xCount).toBe(NOTES_INDEX_LIMIT);
  });
});

describe("matchesQuery", () => {
  function entryFor(task: Task, notes: string | null = null): SearchEntry {
    return buildSearchIndex([task], () => notes)[0] as SearchEntry;
  }

  test("Treffer im Titel", () => {
    const e = entryFor(makeTask({ title: "Kanban Board bauen" }));
    expect(matchesQuery(e, parseSearchQuery("kanban"))).toBe(true);
  });

  test("Treffer in der Beschreibung", () => {
    const e = entryFor(makeTask({ description: "Enthaelt suchbaren Text" }));
    expect(matchesQuery(e, parseSearchQuery("suchbaren"))).toBe(true);
  });

  test("Treffer in Notizen", () => {
    const e = entryFor(makeTask({ hasNotes: true }), "geheimes Stichwort");
    expect(matchesQuery(e, parseSearchQuery("stichwort"))).toBe(true);
  });

  test("Treffer ueber die volle ID", () => {
    const e = entryFor(makeTask({ id: "abcdef12-3456-7890" }));
    expect(matchesQuery(e, parseSearchQuery("abcdef12-3456-7890"))).toBe(true);
  });

  test("Treffer ueber die Kurz-ID (8 Zeichen)", () => {
    const e = entryFor(makeTask({ id: "abcdef12-3456-7890" }));
    expect(matchesQuery(e, parseSearchQuery("abcdef12"))).toBe(true);
  });

  test("#42 im Titel trifft ueber den Titel-Volltext", () => {
    const e = entryFor(makeTask({ title: "Fix #42 dringend" }));
    expect(matchesQuery(e, parseSearchQuery("#42"))).toBe(true);
  });

  test("zwei Texttoken sind UND-verknuepft", () => {
    const e = entryFor(makeTask({ title: "Kanban Board" }));
    expect(matchesQuery(e, parseSearchQuery("kanban board"))).toBe(true);
    expect(matchesQuery(e, parseSearchQuery("kanban fehlend"))).toBe(false);
  });

  test("Datum und Text sind UND-verknuepft", () => {
    const e = entryFor(makeTask({ title: "Kanban", dueDate: "2026-09-03" }));
    expect(matchesQuery(e, parseSearchQuery("kanban faellig:2026-09"))).toBe(true);
    expect(matchesQuery(e, parseSearchQuery("fehlend faellig:2026-09"))).toBe(false);
  });

  test("dueDate: null trifft mit Datumsfilter nie", () => {
    const e = entryFor(makeTask({ dueDate: null }));
    expect(matchesQuery(e, parseSearchQuery("faellig:2026-09"))).toBe(false);
  });

  test("invalider Datumsfilter trifft nie", () => {
    const e = entryFor(makeTask({ title: "Kanban", dueDate: "2026-09-03" }));
    expect(matchesQuery(e, parseSearchQuery("faellig:morgen"))).toBe(false);
  });

  test("pending filtert nicht -- Task ohne dueDate trifft ueber den Text", () => {
    const e = entryFor(makeTask({ title: "Kanban", dueDate: null }));
    expect(matchesQuery(e, parseSearchQuery("kanban faellig:2026-0"))).toBe(true);
  });

  test("leere Query trifft alles", () => {
    const e = entryFor(makeTask({ title: "Irgendwas" }));
    expect(matchesQuery(e, parseSearchQuery(""))).toBe(true);
  });
});

describe("searchTasks", () => {
  const columns: Column[] = [
    makeColumn({ id: "todo", name: "Todo", position: 0 }),
    makeColumn({ id: "in-progress", name: "In Progress", position: 1 }),
    makeColumn({ id: "done", name: "Done", position: 2, isTerminal: true }),
  ];
  const orphanColumn = makeColumn({ id: ORPHAN_COLUMN_ID, name: "⚠ Ohne Spalte", position: 3 });
  const displayColumns: Column[] = [...columns, orphanColumn];

  test("Reihenfolge folgt displayColumns, Waise landet in der Sammelspalte am Ende", () => {
    const tasks = [
      makeTask({ id: "t-done", title: "In Done", columnId: "done" }),
      makeTask({ id: "t-todo", title: "In Todo", columnId: "todo" }),
      makeTask({ id: "t-orphan", title: "Verwaist", columnId: "gone" }),
      makeTask({ id: "t-ip", title: "In Progress", columnId: "in-progress" }),
    ];
    const index = buildSearchIndex(tasks, () => null);
    const hits = searchTasks(index, parseSearchQuery(""), displayColumns, columns);
    expect(hits.map((t) => t.id)).toEqual(["t-todo", "t-ip", "t-done", "t-orphan"]);
  });
});

describe("locateTask", () => {
  const columns: Column[] = [
    makeColumn({ id: "todo", name: "Todo", position: 0 }),
    makeColumn({ id: "in-progress", name: "In Progress", position: 1 }),
    makeColumn({ id: "done", name: "Done", position: 2, isTerminal: true }),
  ];
  const orphanColumn = makeColumn({ id: ORPHAN_COLUMN_ID, name: "⚠ Ohne Spalte", position: 3 });
  const displayColumns: Column[] = [...columns, orphanColumn];

  const tasks = [
    makeTask({ id: "a", columnId: "todo" }),
    makeTask({ id: "b", columnId: "in-progress" }),
    makeTask({ id: "c", columnId: "in-progress" }),
    makeTask({ id: "d", columnId: "in-progress" }),
    makeTask({ id: "orphan-1", columnId: "gone" }),
  ];

  test("Task in zweiter Spalte, dritte Zeile", () => {
    expect(locateTask("d", tasks, displayColumns, columns)).toEqual({ col: 1, row: 2 });
  });

  test("Waise landet im Index der Sammelspalte", () => {
    expect(locateTask("orphan-1", tasks, displayColumns, columns)).toEqual({ col: 3, row: 0 });
  });

  test("unbekannte ID ergibt null", () => {
    expect(locateTask("nicht-vorhanden", tasks, displayColumns, columns)).toBeNull();
  });
});
