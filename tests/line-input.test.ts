// Unit-Tests fuer die reine Tastenlogik von LineInput (GitHub #50, Plan
// .claude/plans/tui-input-flicker.md Schritt 2). reduceLineInput() nimmt
// Zustand + Taste entgegen und gibt den naechsten Zustand zurueck, ohne
// Renderer oder useInput -- deckt damit Edge Cases ab, die ueber einen echten
// Ink-Mount muehsam zu erzwingen waeren (Backspace am Anfang, Cursor am Ende,
// Home/End, Paste mit Zeilenumbruch).
import { test, expect, describe } from "bun:test";
import { reduceLineInput, initLineInputState, type LineInputState } from "../src/tui/line-input.tsx";
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

describe("initLineInputState", () => {
  test("Cursor steht am Ende der Vorbelegung", () => {
    expect(initLineInputState("Hallo")).toEqual({ value: "Hallo", cursor: 5 });
  });
  test("leere Vorbelegung -- Cursor bei 0", () => {
    expect(initLineInputState("")).toEqual({ value: "", cursor: 0 });
  });
});

describe("reduceLineInput -- Zeichen einfuegen", () => {
  test("Zeichen am Cursor einfuegen, Cursor wandert mit", () => {
    const s: LineInputState = { value: "Hllo", cursor: 1 };
    const { state, action } = reduceLineInput(s, "a", key());
    expect(state).toEqual({ value: "Hallo", cursor: 2 });
    expect(action).toBe("none");
  });

  test("Paste (mehrere Zeichen auf einmal)", () => {
    const s: LineInputState = { value: "", cursor: 0 };
    const { state } = reduceLineInput(s, "Hallo Welt", key());
    expect(state).toEqual({ value: "Hallo Welt", cursor: 10 });
  });

  test("Paste mit Zeilenumbruch -- Umbrueche werden entfernt", () => {
    const s: LineInputState = { value: "", cursor: 0 };
    const { state } = reduceLineInput(s, "Zeile1\nZeile2\r\n", key());
    expect(state.value).toBe("Zeile1Zeile2");
  });

  test("leerer Input nach Entfernen der Umbrueche aendert nichts", () => {
    const s: LineInputState = { value: "x", cursor: 1 };
    const { state, action } = reduceLineInput(s, "\n", key());
    expect(state).toEqual(s);
    expect(action).toBe("none");
  });
});

describe("reduceLineInput -- Backspace/Delete", () => {
  test("Backspace loescht Zeichen vor dem Cursor", () => {
    const s: LineInputState = { value: "Hallo", cursor: 5 };
    const { state } = reduceLineInput(s, "", key({ backspace: true }));
    expect(state).toEqual({ value: "Hall", cursor: 4 });
  });

  test("Backspace am Anfang (Cursor 0) aendert nichts", () => {
    const s: LineInputState = { value: "Hallo", cursor: 0 };
    const { state, action } = reduceLineInput(s, "", key({ backspace: true }));
    expect(state).toEqual(s);
    expect(action).toBe("none");
  });

  test("Delete verhaelt sich wie Backspace (Cursor als Einfuege-Position)", () => {
    const s: LineInputState = { value: "Hallo", cursor: 3 };
    const { state } = reduceLineInput(s, "", key({ delete: true }));
    expect(state).toEqual({ value: "Halo", cursor: 2 });
  });

  test("wiederholtes Backspace bis leer", () => {
    let s: LineInputState = { value: "ab", cursor: 2 };
    s = reduceLineInput(s, "", key({ backspace: true })).state;
    s = reduceLineInput(s, "", key({ backspace: true })).state;
    expect(s).toEqual({ value: "", cursor: 0 });
    const { state, action } = reduceLineInput(s, "", key({ backspace: true }));
    expect(state).toEqual(s);
    expect(action).toBe("none");
  });
});

describe("reduceLineInput -- Cursor-Navigation", () => {
  test("links/rechts bewegt den Cursor, haelt an den Raendern", () => {
    const s: LineInputState = { value: "ab", cursor: 0 };
    expect(reduceLineInput(s, "", key({ leftArrow: true })).state.cursor).toBe(0);
    const mid = reduceLineInput(s, "", key({ rightArrow: true })).state;
    expect(mid.cursor).toBe(1);
    const end = reduceLineInput(mid, "", key({ rightArrow: true })).state;
    expect(end.cursor).toBe(2);
    expect(reduceLineInput(end, "", key({ rightArrow: true })).state.cursor).toBe(2);
  });

  test("Home springt an den Anfang, End ans Ende", () => {
    const s: LineInputState = { value: "Hallo", cursor: 2 };
    expect(reduceLineInput(s, "", key({ home: true })).state.cursor).toBe(0);
    expect(reduceLineInput(s, "", key({ end: true })).state.cursor).toBe(5);
  });

  test("hoch/runter/Tab/Ctrl+C aendern nichts", () => {
    const s: LineInputState = { value: "x", cursor: 1 };
    expect(reduceLineInput(s, "", key({ upArrow: true })).state).toEqual(s);
    expect(reduceLineInput(s, "", key({ downArrow: true })).state).toEqual(s);
    expect(reduceLineInput(s, "", key({ tab: true })).state).toEqual(s);
    expect(reduceLineInput(s, "c", key({ ctrl: true })).state).toEqual(s);
  });
});

describe("reduceLineInput -- Enter/Esc", () => {
  test("Enter loest 'submit' aus, Zustand bleibt unveraendert", () => {
    const s: LineInputState = { value: "Hallo", cursor: 5 };
    const { state, action } = reduceLineInput(s, "", key({ return: true }));
    expect(state).toEqual(s);
    expect(action).toBe("submit");
  });

  test("Esc loest 'cancel' aus, Zustand bleibt unveraendert", () => {
    const s: LineInputState = { value: "Hallo", cursor: 5 };
    const { state, action } = reduceLineInput(s, "", key({ escape: true }));
    expect(state).toEqual(s);
    expect(action).toBe("cancel");
  });
});

// Regressionstests fuer den Code-Point-Fix (gefunden im Review von #50):
// ein Emoji ausserhalb der Basic Multilingual Plane (z.B. 😀, U+1F600)
// besteht aus zwei UTF-16-Code-Units, aber einem Code-Point. Vor dem Fix
// zerlegte ein Backspace direkt danach das Surrogatpaar in ein einzelnes,
// ungueltiges Lone-Surrogate-Zeichen.
describe("reduceLineInput -- Emoji (Code-Points statt Code-Units)", () => {
  const EMOJI = "😀"; // U+1F600, zwei UTF-16-Code-Units, ein Code-Point

  test("initLineInputState zaehlt den Cursor in Code-Points", () => {
    expect(initLineInputState(EMOJI)).toEqual({ value: EMOJI, cursor: 1 });
    expect(initLineInputState(`${EMOJI}a`)).toEqual({ value: `${EMOJI}a`, cursor: 2 });
  });

  test("Emoji eintippen bewegt den Cursor um einen Code-Point", () => {
    const s: LineInputState = { value: "", cursor: 0 };
    const { state } = reduceLineInput(s, EMOJI, key());
    expect(state).toEqual({ value: EMOJI, cursor: 1 });
  });

  test("Backspace nach einem Emoji loescht das ganze Emoji, kein Lone Surrogate", () => {
    const s: LineInputState = { value: EMOJI, cursor: 1 };
    const { state } = reduceLineInput(s, "", key({ backspace: true }));
    expect(state).toEqual({ value: "", cursor: 0 });
    // Kein einzelnes Surrogat-Halbzeichen uebrig -- der String ist entweder
    // leer oder besteht nur aus vollstaendigen Code-Points.
    expect([...state.value].join("")).toBe(state.value);
  });

  test("Backspace zwischen zwei Emoji loescht genau eines, nicht ein halbes", () => {
    const s: LineInputState = { value: `${EMOJI}${EMOJI}`, cursor: 1 };
    const { state } = reduceLineInput(s, "", key({ backspace: true }));
    expect(state).toEqual({ value: EMOJI, cursor: 0 });
  });

  test("rechte Pfeiltaste bewegt den Cursor um ein Emoji, nicht um eine Code-Unit", () => {
    const s: LineInputState = { value: `${EMOJI}x`, cursor: 0 };
    const { state } = reduceLineInput(s, "", key({ rightArrow: true }));
    expect(state.cursor).toBe(1);
  });

  test("End springt hinter das letzte Emoji, nicht hinter dessen erste Code-Unit", () => {
    const s: LineInputState = { value: `a${EMOJI}`, cursor: 0 };
    const { state } = reduceLineInput(s, "", key({ end: true }));
    expect(state.cursor).toBe(2);
  });
});
