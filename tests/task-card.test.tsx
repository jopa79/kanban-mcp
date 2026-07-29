// Mount-Tests fuer TaskCard (P2-3, Ueberfaellig-Marker). Nutzt Inks eigenes
// renderToString() (kein useInput, keine TTY noetig, keine neue Dependency --
// ink ist bereits Projekt-Abhaengigkeit) um echten Rendering-Output zu
// pruefen statt nur JSX von Auge zu lesen. Farbwerte selbst sind darueber
// NICHT pruefbar (ANSI-Ausgabe haengt vom Color-Support der Umgebung ab, in
// dieser Sandbox ohne TTY werden standardmaessig gar keine Farbcodes
// emittiert) -- geprueft wird deshalb der Text-/Marker-Inhalt, nicht die Farbe.
import React from "react";
import { renderToString } from "ink";
import { test, expect, describe } from "bun:test";
import { TaskCard } from "../src/tui/task-card.tsx";
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

function renderCard(task: Task) {
  const out = renderToString(
    <TaskCard task={task} isSelected={false} columnColor="#3b82f6" />,
    { columns: 40 },
  );
  return out.replace(/\x1b\[[0-9;]*m/g, ""); // ANSI entfernen, nur Text pruefen
}

describe("TaskCard — Ueberfaellig-Marker", () => {
  test("kein Marker, wenn isOverdue nicht gesetzt ist (Default-Fall)", () => {
    const text = renderCard(makeTask());
    expect(text).not.toContain("[!]");
  });

  test("kein Marker, wenn isOverdue explizit false ist", () => {
    const text = renderCard(makeTask({ isOverdue: false }));
    expect(text).not.toContain("[!]");
  });

  test("Marker erscheint, wenn isOverdue true ist", () => {
    const text = renderCard(makeTask({ isOverdue: true }));
    expect(text).toContain("[!]");
  });

  test("Ueberfaellig-Marker steht vor dem Blockiert-Marker", () => {
    const text = renderCard(makeTask({ isOverdue: true, isBlocked: true }));
    expect(text).toContain("[!]");
    expect(text).toContain("[B]");
    expect(text.indexOf("[!]")).toBeLessThan(text.indexOf("[B]"));
  });

  test("Titel bleibt lesbar, wenn beide Marker gleichzeitig aktiv sind", () => {
    const text = renderCard(makeTask({ isOverdue: true, isBlocked: true, hasNotes: true }));
    expect(text).toContain("Testtask");
  });
});

describe("TaskCard — Prioritaet erscheint bewusst NICHT auf der Karte (K-2)", () => {
  // K-2: Prioritaet ist nachschlagbar, gehoert deshalb in die Detailansicht --
  // die Karte zeigt nur den Ueberfaellig-Marker. Dieser Test haelt die
  // Entscheidung fest, damit sie nicht versehentlich zurueckrutscht.
  test("kein Prioritaets-Text/-Symbol auf der Karte, unabhaengig vom Wert", () => {
    for (const priority of ["high", "medium", "low"] as const) {
      const text = renderCard(makeTask({ priority }));
      expect(text).not.toMatch(/Hoch|Mittel|Niedrig/);
    }
  });
});
