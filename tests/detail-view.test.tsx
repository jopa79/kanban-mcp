// Mount-Tests fuer DetailView (P2-3, Prioritaet + Faelligkeit im Klartext).
// Siehe Kommentar in task-card.test.ts zur renderToString()-Strategie: Text-
// Inhalt wird geprueft, keine Farbwerte (ANSI-Ausgabe ist umgebungsabhaengig).
import React from "react";
import { renderToString } from "ink";
import { test, expect, describe } from "bun:test";
import { DetailView } from "../src/tui/detail-view.tsx";
import type { Task } from "../src/core/types.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "Testtask",
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

function renderDetail(task: Task) {
  const out = renderToString(<DetailView task={task} />, { columns: 60 });
  return out.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("DetailView — Prioritaet", () => {
  test("zeigt 'Hoch' fuer priority: 'high'", () => {
    expect(renderDetail(makeTask({ priority: "high" }))).toContain("Prioritaet: Hoch");
  });

  test("zeigt 'Mittel' fuer priority: 'medium'", () => {
    expect(renderDetail(makeTask({ priority: "medium" }))).toContain("Prioritaet: Mittel");
  });

  test("zeigt 'Niedrig' fuer priority: 'low'", () => {
    expect(renderDetail(makeTask({ priority: "low" }))).toContain("Prioritaet: Niedrig");
  });

  test("zeigt Platzhalter, wenn priority null ist", () => {
    expect(renderDetail(makeTask({ priority: null }))).toContain("Prioritaet: —");
  });
});

describe("DetailView — Faelligkeit", () => {
  test("zeigt das ISO-Datum, wenn dueDate gesetzt ist", () => {
    expect(renderDetail(makeTask({ dueDate: "2026-08-01" }))).toContain("Faellig: 2026-08-01");
  });

  test("zeigt Platzhalter, wenn dueDate null ist", () => {
    expect(renderDetail(makeTask({ dueDate: null }))).toContain("Faellig: —");
  });

  test("markiert ueberfaellige Tasks zusaetzlich im Klartext", () => {
    const text = renderDetail(makeTask({ dueDate: "2020-01-01", isOverdue: true }));
    expect(text).toContain("Faellig: 2020-01-01");
    expect(text.toLowerCase()).toContain("ueberfaellig");
  });

  test("Done-Task mit vergangenem Datum aber isOverdue: false zeigt KEINE Ueberfaellig-Markierung", () => {
    // isOverdue wird vom TaskService berechnet (terminal-Spalten sind nie
    // ueberfaellig) -- die TUI verlaesst sich rein auf das Flag, rechnet
    // selbst nichts nach.
    const text = renderDetail(makeTask({ dueDate: "2020-01-01", isOverdue: false, columnId: "done" }));
    expect(text.toLowerCase()).not.toContain("ueberfaellig");
  });
});

describe("DetailView — bestehende Felder bleiben unveraendert", () => {
  test("Titel, Spalte und Blockiert-Hinweis werden weiterhin angezeigt", () => {
    const text = renderDetail(makeTask({ isBlocked: true, columnId: "in-progress" }));
    expect(text).toContain("Testtask");
    expect(text).toContain("in-progress");
    expect(text).toContain("BLOCKIERT");
  });

  test("Fusszeile nennt jetzt auch 'p' fuer Prioritaet", () => {
    const text = renderDetail(makeTask());
    expect(text).toMatch(/p=Priorit/);
  });
});
