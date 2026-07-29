// Mount-Test fuer PriorityPicker (P2-3). renderToString() macht useInput()
// laut Ink-Doku zu einem No-Op (keine TTY) -- Tastatur-Interaktion (Pfeiltasten,
// Enter, Esc) ist damit NICHT automatisiert pruefbar (siehe Bericht an
// team-lead, bekannte Sandbox-Einschraenkung). Was sich trotzdem echt pruefen
// laesst: der initiale, durch Props bestimmte Render-Zustand -- welche Option
// als aktuell gesetzt markiert ist ("(x)" vs "( )"), Reihenfolge und Labels.
// Cursor-Highlight (inverse=true) ist ueber reine Textausgabe nicht pruefbar
// (keine ANSI-Codes ohne Color-Support in dieser Sandbox, siehe task-card.test.ts).
import React from "react";
import { renderToString } from "ink";
import { test, expect, describe } from "bun:test";
import { PriorityPicker } from "../src/tui/priority-picker.tsx";

function renderPicker(selected: "high" | "medium" | "low" | null) {
  const out = renderToString(
    <PriorityPicker selected={selected} onSave={() => {}} onCancel={() => {}} />,
    { columns: 40 },
  );
  return out.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("PriorityPicker — initialer Render-Zustand", () => {
  test("zeigt alle vier Optionen in fester Reihenfolge: Hoch, Mittel, Niedrig, Keine", () => {
    const text = renderPicker(null);
    const order = ["Hoch", "Mittel", "Niedrig", "Keine"].map((label) => text.indexOf(label));
    expect(order.every((idx) => idx !== -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("markiert 'high' als aktuell gesetzt, alle anderen unmarkiert", () => {
    const text = renderPicker("high");
    expect(text).toContain("(x) Hoch");
    expect(text).toContain("( ) Mittel");
    expect(text).toContain("( ) Niedrig");
    expect(text).toContain("( ) Keine");
  });

  test("markiert 'medium' als aktuell gesetzt", () => {
    const text = renderPicker("medium");
    expect(text).toContain("( ) Hoch");
    expect(text).toContain("(x) Mittel");
  });

  test("selected: null markiert 'Keine' als aktuell gesetzt", () => {
    const text = renderPicker(null);
    expect(text).toContain("(x) Keine");
    expect(text).toContain("( ) Hoch");
    expect(text).toContain("( ) Mittel");
    expect(text).toContain("( ) Niedrig");
  });

  test("Fusszeile nennt die Bedienung (Pfeiltasten/Enter/Esc)", () => {
    const text = renderPicker(null);
    expect(text).toMatch(/Enter/);
    expect(text).toMatch(/Esc/);
  });
});
