// Multi-Line Texteditor fuer die Kanban TUI.
//
// Wie LineInput (siehe dortiger Kommentar, GitHub #50, Plan
// .claude/plans/tui-input-flicker.md Schritt 3) hielt dieser Editor
// 'lines'/'row'/'col' bisher in drei separaten useState-Slots und las sie im
// useInput-Handler aus dem Closure. Inks useInput() registriert seinen
// Handler in einem useEffect mit dem Handler selbst als Dependency -- bei
// schnellem Tippen konnte deshalb noch der ALTE Handler mit ALTEN Werten
// laufen, bis der Passive-Effect nachzog. Gleiches Stale-Closure-Risiko wie
// bei LineInput, hier fuer den Notizen-Editor.
//
// editRef ist die alleinige Quelle der Wahrheit fuer den Editier-Zustand
// (Zeilen + Cursor): jeder Tastendruck liest und schreibt editRef.current
// SYNCHRON im Handler, unabhaengig davon, welche Handler-Generation gerade
// laeuft. Der Speichern-Dialog (editing/confirm-exit) bleibt ein eigener
// useState -- er wechselt nie waehrend eines Tipp-Bursts, das Stale-Closure-
// Risiko besteht dort nicht. 'onSave' im Dialog liest trotzdem aus dem Ref,
// nicht aus dem Editing-State, damit auch dort garantiert der vollstaendige
// Text ankommt.
import React, { useRef, useState } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ACCENT } from "./theme.ts";

type DialogState = "editing" | "confirm-exit";

export interface TextAreaEditState {
  lines: string[];
  row: number;
  col: number;
}

export function initTextAreaState(initialValue: string): TextAreaEditState {
  return { lines: initialValue ? initialValue.split("\n") : [""], row: 0, col: 0 };
}

export type TextAreaAction = "none" | "open-confirm";

// Zeilenlaenge/Cursor als Code-Points, nicht als UTF-16-Code-Units --
// gleicher Grund wie in line-input.tsx (siehe Kommentar dort, Review von
// #50): ein Emoji ausserhalb der Basic Multilingual Plane besteht aus zwei
// Code-Units, aber einem Code-Point. Ein Cursor in Code-Units koennte
// mitten in ein Surrogatpaar zeigen.
function codePointLength(line: string): number {
  return [...line].length;
}

// Reine Editier-Logik (Zeilen/Cursor) ohne State-Zugriff aus einem Closure --
// separat testbar ohne Renderer (siehe tests/text-area.test.ts). Der
// Speichern-Dialog selbst gehoert NICHT hierher (siehe Datei-Kommentar oben);
// Esc gibt nur 'open-confirm' zurueck, den Wechsel macht die Komponente.
//
// Rechnet Zeileninhalte durchgehend ueber ein Code-Point-Array ('chars'),
// nicht ueber UTF-16-Indizes des Strings direkt. Deckt Emoji als einzelnen
// Code-Point ab, nicht Grapheme-Cluster (siehe line-input.tsx-Kommentar zum
// selben Fix -- dort ausfuehrlich begruendet, gilt hier identisch).
export function reduceTextArea(
  state: TextAreaEditState,
  input: string,
  key: Key,
): { state: TextAreaEditState; action: TextAreaAction } {
  if (key.escape) return { state, action: "open-confirm" };

  const { lines, row, col } = state;
  const chars = [...lines[row]!];

  if (key.return) {
    const before = chars.slice(0, col).join("");
    const after = chars.slice(col).join("");
    const next = [...lines];
    next[row] = before;
    next.splice(row + 1, 0, after);
    return { state: { lines: next, row: row + 1, col: 0 }, action: "none" };
  }

  if (key.backspace || key.delete) {
    if (col > 0) {
      const rowChars = [...chars];
      rowChars.splice(col - 1, 1);
      const next = [...lines];
      next[row] = rowChars.join("");
      return { state: { lines: next, row, col: col - 1 }, action: "none" };
    }
    if (row > 0) {
      const next = [...lines];
      const prevLen = codePointLength(next[row - 1]!);
      next[row - 1] += next[row]!;
      next.splice(row, 1);
      return { state: { lines: next, row: row - 1, col: prevLen }, action: "none" };
    }
    return { state, action: "none" };
  }

  if (key.upArrow) {
    if (row === 0) return { state, action: "none" };
    return { state: { lines, row: row - 1, col: Math.min(col, codePointLength(lines[row - 1]!)) }, action: "none" };
  }
  if (key.downArrow) {
    if (row >= lines.length - 1) return { state, action: "none" };
    return { state: { lines, row: row + 1, col: Math.min(col, codePointLength(lines[row + 1]!)) }, action: "none" };
  }
  if (key.leftArrow) {
    if (col > 0) return { state: { lines, row, col: col - 1 }, action: "none" };
    if (row > 0) return { state: { lines, row: row - 1, col: codePointLength(lines[row - 1]!) }, action: "none" };
    return { state, action: "none" };
  }
  if (key.rightArrow) {
    if (col < chars.length) return { state: { lines, row, col: col + 1 }, action: "none" };
    if (row < lines.length - 1) return { state: { lines, row: row + 1, col: 0 }, action: "none" };
    return { state, action: "none" };
  }

  if (key.tab) {
    const rowChars = [...chars];
    rowChars.splice(col, 0, " ", " ");
    const next = [...lines];
    next[row] = rowChars.join("");
    return { state: { lines: next, row, col: col + 2 }, action: "none" };
  }

  if (input && !key.ctrl && !key.meta) {
    const rowChars = [...chars];
    const insertChars = [...input];
    rowChars.splice(col, 0, ...insertChars);
    const next = [...lines];
    next[row] = rowChars.join("");
    return { state: { lines: next, row, col: col + insertChars.length }, action: "none" };
  }

  return { state, action: "none" };
}

interface TextAreaProps {
  initialValue: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}

export function TextArea({ initialValue, onSave, onCancel }: TextAreaProps) {
  const editRef = useRef<TextAreaEditState>(initTextAreaState(initialValue));
  const [editState, setEditState] = useState<TextAreaEditState>(editRef.current);
  const [dialog, setDialog] = useState<DialogState>("editing");

  useInput((input, key) => {
    // Speichern-Dialog: Enter=Ja (default), n=Nein, Esc=Zurueck zum Editor
    if (dialog === "confirm-exit") {
      if (key.return || input === "y" || input === "j") {
        onSave(editRef.current.lines.join("\n"));
        return;
      }
      if (input === "n") {
        onCancel();
        return;
      }
      if (key.escape) {
        setDialog("editing");
        return;
      }
      return;
    }

    const { state: next, action } = reduceTextArea(editRef.current, input, key);
    editRef.current = next;
    setEditState(next);
    if (action === "open-confirm") setDialog("confirm-exit");
  });

  const { lines, row, col } = editState;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={ACCENT.notes} bold>Notizen editieren:</Text>
      <Box flexDirection="column" borderStyle="single" paddingX={1} minHeight={3}>
        {lines.map((line, i) => {
          // Code-Points statt UTF-16-Indizes, damit Cursor-Position und
          // reduceTextArea() (siehe dortiger Kommentar) uebereinstimmen --
          // sonst zeigt der Cursor bei einem Emoji vor ihm ins Leere.
          const rowChars = i === row ? [...line] : null;
          return (
            <Box key={i}>
              <Text color={ACCENT.muted}>{String(i + 1).padStart(2)} </Text>
              {rowChars ? (
                <Text>
                  {rowChars.slice(0, col).join("")}
                  <Text inverse>{rowChars[col] ?? " "}</Text>
                  {rowChars.slice(col + 1).join("")}
                </Text>
              ) : (
                <Text>{line || " "}</Text>
              )}
            </Box>
          );
        })}
      </Box>
      {dialog === "confirm-exit" ? (
        <Text color={ACCENT.notes} bold>
          Speichern? [<Text color="#22c55e">Y/Enter</Text>=Ja  n=Nein  Esc=Zurueck]
        </Text>
      ) : (
        <Text color={ACCENT.muted}>Esc = Beenden  Enter = Neue Zeile</Text>
      )}
    </Box>
  );
}
