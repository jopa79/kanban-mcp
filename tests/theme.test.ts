// Tests fuer die Prioritaets-/Ueberfaellig-Farblogik in src/tui/theme.ts (P2-3).
// Reine Funktionen, kein Ink-Rendering noetig -- direkt testbar.
import { test, expect, describe } from "bun:test";
import { ACCENT, getPriorityColor, getPriorityLabel } from "../src/tui/theme.ts";

describe("getPriorityColor", () => {
  test("liefert fuer high/medium/low je eine eigene Hex-Farbe", () => {
    const high = getPriorityColor("high");
    const medium = getPriorityColor("medium");
    const low = getPriorityColor("low");
    expect(high).toMatch(/^#[0-9a-f]{6}$/i);
    expect(medium).toMatch(/^#[0-9a-f]{6}$/i);
    expect(low).toMatch(/^#[0-9a-f]{6}$/i);
  });

  test("high, medium, low und 'keine' sind vier unterscheidbare Farben", () => {
    const colors = [getPriorityColor("high"), getPriorityColor("medium"), getPriorityColor("low"), getPriorityColor(null)];
    expect(new Set(colors).size).toBe(4);
  });

  test("null (keine Prioritaet) nutzt die gedaempfte Muted-Farbe, nicht 'low'", () => {
    // Wichtig: 'niedrig' und 'keine Angabe' duerfen nicht dieselbe Farbe teilen,
    // sonst ist in der Detailansicht nicht zu unterscheiden, ob eine Prioritaet
    // bewusst auf 'low' gesetzt oder schlicht nie gesetzt wurde.
    expect(getPriorityColor(null)).toBe(ACCENT.muted);
    expect(getPriorityColor(null)).not.toBe(getPriorityColor("low"));
  });
});

describe("getPriorityLabel", () => {
  test("liefert deutsche Klartext-Label fuer alle drei Stufen", () => {
    expect(getPriorityLabel("high")).toBe("Hoch");
    expect(getPriorityLabel("medium")).toBe("Mittel");
    expect(getPriorityLabel("low")).toBe("Niedrig");
  });

  test("liefert einen Platzhalter fuer null, analog zu anderen leeren Feldern", () => {
    expect(getPriorityLabel(null)).toBe("—");
  });
});

describe("ACCENT.overdue", () => {
  test("existiert und unterscheidet sich von wipWarn (Blockiert-Marker)", () => {
    // Ein Task kann gleichzeitig blockiert UND ueberfaellig sein -- zwei
    // Klammer-Marker in identischer Farbe waeren auf der schmalen Karte
    // schwerer auseinanderzuhalten als zwei unterscheidbare Farbtoene.
    expect(ACCENT.overdue).toMatch(/^#[0-9a-f]{6}$/i);
    expect(ACCENT.overdue).not.toBe(ACCENT.wipWarn);
  });
});
