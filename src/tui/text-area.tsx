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

// Reine Editier-Logik (Zeilen/Cursor) ohne State-Zugriff aus einem Closure --
// separat testbar ohne Renderer (siehe tests/text-area.test.ts). Der
// Speichern-Dialog selbst gehoert NICHT hierher (siehe Datei-Kommentar oben);
// Esc gibt nur 'open-confirm' zurueck, den Wechsel macht die Komponente.
export function reduceTextArea(
  state: TextAreaEditState,
  input: string,
  key: Key,
): { state: TextAreaEditState; action: TextAreaAction } {
  if (key.escape) return { state, action: "open-confirm" };

  const { lines, row, col } = state;

  if (key.return) {
    const before = lines[row]!.slice(0, col);
    const after = lines[row]!.slice(col);
    const next = [...lines];
    next[row] = before;
    next.splice(row + 1, 0, after);
    return { state: { lines: next, row: row + 1, col: 0 }, action: "none" };
  }

  if (key.backspace || key.delete) {
    if (col > 0) {
      const next = [...lines];
      next[row] = next[row]!.slice(0, col - 1) + next[row]!.slice(col);
      return { state: { lines: next, row, col: col - 1 }, action: "none" };
    }
    if (row > 0) {
      const next = [...lines];
      const prevLen = next[row - 1]!.length;
      next[row - 1] += next[row]!;
      next.splice(row, 1);
      return { state: { lines: next, row: row - 1, col: prevLen }, action: "none" };
    }
    return { state, action: "none" };
  }

  if (key.upArrow) {
    if (row === 0) return { state, action: "none" };
    return { state: { lines, row: row - 1, col: Math.min(col, lines[row - 1]!.length) }, action: "none" };
  }
  if (key.downArrow) {
    if (row >= lines.length - 1) return { state, action: "none" };
    return { state: { lines, row: row + 1, col: Math.min(col, lines[row + 1]!.length) }, action: "none" };
  }
  if (key.leftArrow) {
    if (col > 0) return { state: { lines, row, col: col - 1 }, action: "none" };
    if (row > 0) return { state: { lines, row: row - 1, col: lines[row - 1]!.length }, action: "none" };
    return { state, action: "none" };
  }
  if (key.rightArrow) {
    if (col < lines[row]!.length) return { state: { lines, row, col: col + 1 }, action: "none" };
    if (row < lines.length - 1) return { state: { lines, row: row + 1, col: 0 }, action: "none" };
    return { state, action: "none" };
  }

  if (key.tab) {
    const next = [...lines];
    next[row] = next[row]!.slice(0, col) + "  " + next[row]!.slice(col);
    return { state: { lines: next, row, col: col + 2 }, action: "none" };
  }

  if (input && !key.ctrl && !key.meta) {
    const next = [...lines];
    next[row] = next[row]!.slice(0, col) + input + next[row]!.slice(col);
    return { state: { lines: next, row, col: col + input.length }, action: "none" };
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
        {lines.map((line, i) => (
          <Box key={i}>
            <Text color={ACCENT.muted}>{String(i + 1).padStart(2)} </Text>
            {i === row ? (
              <Text>
                {line.slice(0, col)}
                <Text inverse>{line[col] ?? " "}</Text>
                {line.slice(col + 1)}
              </Text>
            ) : (
              <Text>{line || " "}</Text>
            )}
          </Box>
        ))}
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
