// Unit-Tests fuer die reine Editier-Logik von TextArea (GitHub #50, Plan
// .claude/plans/tui-input-flicker.md Schritt 3). reduceTextArea() nimmt
// Zustand + Taste entgegen und gibt den naechsten Zustand zurueck, ohne
// Renderer oder useInput -- deckt Edge Cases ab, die ueber einen echten
// Ink-Mount muehsam zu erzwingen waeren (Enter mitten in der Zeile,
// Backspace am Zeilenanfang, Pfeil hoch mit kuerzerer Zielzeile, Tab).
import { test, expect, describe } from "bun:test";
import { reduceTextArea, initTextAreaState, type TextAreaEditState } from "../src/tui/text-area.tsx";
import type { Key } from "ink";

function key(overrides: Partial<Key> = {}): Key {
  return {
    upArrow: false, downArrow: false, leftArrow: false, rightArrow: false,
    pageDown: false, pageUp: false, home: false, end: false, return: false,
    escape: false, ctrl: false, shift: false, tab: false, backspace: false,
    delete: false, meta: false, super: false, hyper: false, capsLock: false,
    numLock: false, eventType: "press",
    ...overrides,
  } as Key;
}

describe("initTextAreaState", () => {
  test("mehrzeilige Vorbelegung wird an Zeilenumbruechen gesplittet", () => {
    expect(initTextAreaState("Zeile1\nZeile2")).toEqual({ lines: ["Zeile1", "Zeile2"], row: 0, col: 0 });
  });
  test("leere Vorbelegung -- eine leere Zeile", () => {
    expect(initTextAreaState("")).toEqual({ lines: [""], row: 0, col: 0 });
  });
});

describe("reduceTextArea -- Enter", () => {
  test("Enter mitten in der Zeile teilt sie an der Cursor-Position", () => {
    const s: TextAreaEditState = { lines: ["Hallo Welt"], row: 0, col: 6 };
    const { state, action } = reduceTextArea(s, "", key({ return: true }));
    expect(state).toEqual({ lines: ["Hallo ", "Welt"], row: 1, col: 0 });
    expect(action).toBe("none");
  });

  test("Enter am Zeilenende erzeugt eine leere Folgezeile", () => {
    const s: TextAreaEditState = { lines: ["Hallo"], row: 0, col: 5 };
    const { state } = reduceTextArea(s, "", key({ return: true }));
    expect(state).toEqual({ lines: ["Hallo", ""], row: 1, col: 0 });
  });
});

describe("reduceTextArea -- Backspace/Delete", () => {
  test("Backspace mitten in der Zeile loescht ein Zeichen", () => {
    const s: TextAreaEditState = { lines: ["Hallo"], row: 0, col: 3 };
    const { state } = reduceTextArea(s, "", key({ backspace: true }));
    expect(state).toEqual({ lines: ["Halo"], row: 0, col: 2 });
  });

  test("Backspace am Zeilenanfang fuehrt mit der vorherigen Zeile zusammen", () => {
    const s: TextAreaEditState = { lines: ["Hallo", "Welt"], row: 1, col: 0 };
    const { state } = reduceTextArea(s, "", key({ backspace: true }));
    expect(state).toEqual({ lines: ["HalloWelt"], row: 0, col: 5 });
  });

  test("Backspace in der ersten Zeile am Anfang aendert nichts", () => {
    const s: TextAreaEditState = { lines: ["Hallo"], row: 0, col: 0 };
    const { state, action } = reduceTextArea(s, "", key({ backspace: true }));
    expect(state).toEqual(s);
    expect(action).toBe("none");
  });
});

describe("reduceTextArea -- Navigation", () => {
  test("Pfeil hoch mit kuerzerer Zielzeile begrenzt die Spalte", () => {
    const s: TextAreaEditState = { lines: ["ab", "Hallo"], row: 1, col: 5 };
    const { state } = reduceTextArea(s, "", key({ upArrow: true }));
    expect(state).toEqual({ lines: ["ab", "Hallo"], row: 0, col: 2 });
  });

  test("Pfeil runter mit kuerzerer Zielzeile begrenzt die Spalte", () => {
    const s: TextAreaEditState = { lines: ["Hallo", "ab"], row: 0, col: 5 };
    const { state } = reduceTextArea(s, "", key({ downArrow: true }));
    expect(state).toEqual({ lines: ["Hallo", "ab"], row: 1, col: 2 });
  });

  test("Pfeil hoch in der ersten Zeile aendert nichts", () => {
    const s: TextAreaEditState = { lines: ["a", "b"], row: 0, col: 0 };
    const { state } = reduceTextArea(s, "", key({ upArrow: true }));
    expect(state).toEqual(s);
  });

  test("Pfeil links am Zeilenanfang springt ans Ende der vorherigen Zeile", () => {
    const s: TextAreaEditState = { lines: ["Hallo", "Welt"], row: 1, col: 0 };
    const { state } = reduceTextArea(s, "", key({ leftArrow: true }));
    expect(state).toEqual({ lines: ["Hallo", "Welt"], row: 0, col: 5 });
  });

  test("Pfeil rechts am Zeilenende springt an den Anfang der naechsten Zeile", () => {
    const s: TextAreaEditState = { lines: ["Hallo", "Welt"], row: 0, col: 5 };
    const { state } = reduceTextArea(s, "", key({ rightArrow: true }));
    expect(state).toEqual({ lines: ["Hallo", "Welt"], row: 1, col: 0 });
  });
});

describe("reduceTextArea -- Tab und Zeichen", () => {
  test("Tab fuegt zwei Leerzeichen ein", () => {
    const s: TextAreaEditState = { lines: ["ab"], row: 0, col: 1 };
    const { state } = reduceTextArea(s, "", key({ tab: true }));
    expect(state).toEqual({ lines: ["a  b"], row: 0, col: 3 });
  });

  test("normales Zeichen wird an der Cursor-Position eingefuegt", () => {
    const s: TextAreaEditState = { lines: ["Hllo"], row: 0, col: 1 };
    const { state } = reduceTextArea(s, "a", key());
    expect(state).toEqual({ lines: ["Hallo"], row: 0, col: 2 });
  });

  test("Ctrl-Kombination fuegt kein Zeichen ein", () => {
    const s: TextAreaEditState = { lines: ["x"], row: 0, col: 1 };
    const { state, action } = reduceTextArea(s, "c", key({ ctrl: true }));
    expect(state).toEqual(s);
    expect(action).toBe("none");
  });
});

describe("reduceTextArea -- Esc", () => {
  test("Esc loest 'open-confirm' aus, Editier-Zustand bleibt unveraendert", () => {
    const s: TextAreaEditState = { lines: ["Hallo"], row: 0, col: 3 };
    const { state, action } = reduceTextArea(s, "", key({ escape: true }));
    expect(state).toEqual(s);
    expect(action).toBe("open-confirm");
  });
});

// Regressionstests fuer den Code-Point-Fix (gleicher Fund wie bei
// LineInput, siehe tests/line-input.test.ts): ein Emoji ausserhalb der
// Basic Multilingual Plane besteht aus zwei UTF-16-Code-Units, aber einem
// Code-Point.
describe("reduceTextArea -- Emoji (Code-Points statt Code-Units)", () => {
  const EMOJI = "😀"; // U+1F600, zwei UTF-16-Code-Units, ein Code-Point

  test("Emoji eintippen bewegt den Cursor um einen Code-Point", () => {
    const s: TextAreaEditState = { lines: [""], row: 0, col: 0 };
    const { state } = reduceTextArea(s, EMOJI, key());
    expect(state).toEqual({ lines: [EMOJI], row: 0, col: 1 });
  });

  test("Backspace nach einem Emoji loescht das ganze Emoji, kein Lone Surrogate", () => {
    const s: TextAreaEditState = { lines: [EMOJI], row: 0, col: 1 };
    const { state } = reduceTextArea(s, "", key({ backspace: true }));
    expect(state).toEqual({ lines: [""], row: 0, col: 0 });
  });

  test("Backspace zwischen zwei Emoji loescht genau eines, nicht ein halbes", () => {
    const s: TextAreaEditState = { lines: [`${EMOJI}${EMOJI}`], row: 0, col: 1 };
    const { state } = reduceTextArea(s, "", key({ backspace: true }));
    expect(state).toEqual({ lines: [EMOJI], row: 0, col: 0 });
  });

  test("rechte Pfeiltaste bewegt den Cursor um ein Emoji, nicht um eine Code-Unit", () => {
    const s: TextAreaEditState = { lines: [`${EMOJI}x`], row: 0, col: 0 };
    const { state } = reduceTextArea(s, "", key({ rightArrow: true }));
    expect(state.col).toBe(1);
  });

  test("Pfeil hoch mit Emoji in der Zielzeile begrenzt die Spalte in Code-Points", () => {
    const s: TextAreaEditState = { lines: [EMOJI, "Hallo"], row: 1, col: 5 };
    const { state } = reduceTextArea(s, "", key({ upArrow: true }));
    expect(state).toEqual({ lines: [EMOJI, "Hallo"], row: 0, col: 1 });
  });
});
