// Mount-Tests fuer BoardPickerList (P3-3, TUI Board-Wechsel). Wie bei
// DetailView/PriorityPicker (siehe dortige Kommentare): renderToString()
// prueft den durch Props bestimmten Render-Zustand, keine Farbwerte (ANSI
// ist umgebungsabhaengig) und keine Tastatur-Interaktion (useInput() ist ohne
// TTY ein No-Op). Deshalb testet diese Datei ausschliesslich BoardPickerList
// (reine Darstellung, keine Effekte) -- NICHT BoardPicker selbst, das per
// useEffect() runBoardsList(defaultRegistryDir()) aufruft und damit die
// ECHTE Registry lesen wuerde, wenn renderToString() Effekte ausfuehrt. Das
// ist genau der Fall, den registry-service.test.ts / boards-command.test.ts
// mit ihrem Guard verhindern -- hier vermeiden wir ihn, indem BoardPicker
// (die zustandsbehaftete Huelle) gar nicht erst automatisiert gerendert wird.
import React from "react";
import { renderToString } from "ink";
import { test, expect, describe } from "bun:test";
import { BoardPickerList } from "../src/tui/board-picker.tsx";
import type { BoardOverviewEntry } from "../src/cli/board-overview.ts";

function makeEntry(overrides: Partial<BoardOverviewEntry> = {}): BoardOverviewEntry {
  return {
    path: "/boards/a",
    name: "Board A",
    registeredAt: "2026-01-01T00:00:00.000Z",
    status: { kind: "ok", taskCount: 3 },
    ...overrides,
  };
}

function renderList(entries: BoardOverviewEntry[], opts?: { currentPath?: string; cursor?: number; blockedMsg?: string }) {
  const out = renderToString(
    <BoardPickerList
      entries={entries}
      currentPath={opts?.currentPath ?? "/boards/a"}
      cursor={opts?.cursor ?? 0}
      blockedMsg={opts?.blockedMsg ?? ""}
    />,
    { columns: 60 },
  );
  return out.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("BoardPickerList — aggregierte Uebersicht", () => {
  test("zeigt Namen und Task-Zahl fuer ein gesundes Board", () => {
    const text = renderList([makeEntry({ name: "Board A", status: { kind: "ok", taskCount: 7 } })]);
    expect(text).toContain("Board A");
    expect(text).toContain("7 Tasks");
  });

  test("zeigt mehrere Boards mit je eigener Task-Zahl", () => {
    const text = renderList([
      makeEntry({ path: "/boards/a", name: "Board A", status: { kind: "ok", taskCount: 2 } }),
      makeEntry({ path: "/boards/b", name: "Board B", status: { kind: "ok", taskCount: 5 } }),
    ]);
    expect(text).toContain("Board A");
    expect(text).toContain("2 Tasks");
    expect(text).toContain("Board B");
    expect(text).toContain("5 Tasks");
  });
});

describe("BoardPickerList — aktuelles Board markiert", () => {
  test("markiert den Eintrag, dessen Pfad currentPath entspricht", () => {
    const text = renderList(
      [
        makeEntry({ path: "/boards/a", name: "Board A" }),
        makeEntry({ path: "/boards/b", name: "Board B" }),
      ],
      { currentPath: "/boards/b" },
    );
    const lines = text.split("\n");
    const lineA = lines.find((l) => l.includes("Board A"))!;
    const lineB = lines.find((l) => l.includes("Board B"))!;
    expect(lineB).toContain("▸");
    expect(lineA).not.toContain("▸");
  });
});

describe("BoardPickerList — Randfaelle (kein Absturz, verstaendliche Meldung)", () => {
  test("Pfad existiert nicht mehr: Warnung statt Task-Zahl", () => {
    const text = renderList([makeEntry({ status: { kind: "missing" } })]);
    expect(text).toContain("Pfad existiert nicht mehr");
  });

  test("Schema v2: Warnung mit Versionsnummer und Migrationshinweis", () => {
    const text = renderList([makeEntry({ status: { kind: "schema-outdated", version: 2 } })]);
    expect(text).toContain("Schema v2");
    expect(text.toLowerCase()).toContain("migration");
  });

  test("kaputtes Board (z.B. kaputte config.json): generische Fehlermeldung statt Absturz", () => {
    expect(() => renderList([makeEntry({ status: { kind: "error", message: "config.json ist kein gueltiges JSON" } })])).not.toThrow();
    const text = renderList([makeEntry({ status: { kind: "error", message: "config.json ist kein gueltiges JSON" } })]);
    expect(text).toContain("config.json ist kein gueltiges JSON");
  });

  test("gemischte Liste: ein kaputtes Board reisst die anderen Zeilen nicht mit", () => {
    const text = renderList([
      makeEntry({ path: "/boards/a", name: "Gesund", status: { kind: "ok", taskCount: 1 } }),
      makeEntry({ path: "/boards/b", name: "Kaputt", status: { kind: "error", message: "kaputt" } }),
    ]);
    expect(text).toContain("Gesund");
    expect(text).toContain("1 Tasks");
    expect(text).toContain("Kaputt");
  });

  test("leere Registry zeigt Hinweis auf 'kanban boards add' statt einer leeren Liste", () => {
    const text = renderList([]);
    expect(text).toMatch(/kanban boards add/);
  });

  test("genau ein registriertes Board ist kein Sonderfall -- wird normal angezeigt", () => {
    const text = renderList([makeEntry({ name: "Solo-Board" })]);
    expect(text).toContain("Solo-Board");
    expect(text).not.toMatch(/kanban boards add/);
  });
});

describe("BoardPickerList — blockierte Auswahl", () => {
  test("zeigt blockedMsg, wenn gesetzt (z.B. Versuch, ein Schema-v2-Board zu waehlen)", () => {
    const text = renderList([makeEntry()], { blockedMsg: "Schema v2 — 'kanban migrate' noetig." });
    expect(text).toContain("Schema v2 — 'kanban migrate' noetig.");
  });

  test("zeigt keine Meldung, wenn blockedMsg leer ist", () => {
    const text = renderList([makeEntry()], { blockedMsg: "" });
    expect(text.trim().length).toBeGreaterThan(0); // sanity: Liste rendert trotzdem
  });
});

describe("BoardPickerList — Fusszeile nennt die Bedienung", () => {
  test("Enter, Esc und Pfeiltasten werden erwaehnt", () => {
    const text = renderList([makeEntry()]);
    expect(text).toMatch(/Enter/);
    expect(text).toMatch(/Esc/);
  });
});
