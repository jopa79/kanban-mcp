// Multi-Line Texteditor fuer die Kanban TUI
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { ACCENT } from "./theme.ts";

type EditorState = "editing" | "confirm-exit";

interface TextAreaProps {
  initialValue: string;
  onSave: (value: string) => void;
  onCancel: () => void;
}

export function TextArea({ initialValue, onSave, onCancel }: TextAreaProps) {
  const [lines, setLines] = useState<string[]>(
    initialValue ? initialValue.split("\n") : [""]
  );
  const [row, setRow] = useState(0);
  const [col, setCol] = useState(0);
  const [state, setState] = useState<EditorState>("editing");

  useInput((input, key) => {
    // Speichern-Dialog: Enter=Ja (default), n=Nein, Esc=Zurueck zum Editor
    if (state === "confirm-exit") {
      if (key.return || input === "y" || input === "j") {
        onSave(lines.join("\n"));
        return;
      }
      if (input === "n") {
        onCancel();
        return;
      }
      if (key.escape) {
        setState("editing");
        return;
      }
      return;
    }

    // Esc = Speichern-Dialog oeffnen
    if (key.escape) {
      setState("confirm-exit");
      return;
    }

    // Enter = neue Zeile
    if (key.return) {
      const before = lines[row].slice(0, col);
      const after = lines[row].slice(col);
      const next = [...lines];
      next[row] = before;
      next.splice(row + 1, 0, after);
      setLines(next);
      setRow(row + 1);
      setCol(0);
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      if (col > 0) {
        const next = [...lines];
        next[row] = next[row].slice(0, col - 1) + next[row].slice(col);
        setLines(next);
        setCol(col - 1);
      } else if (row > 0) {
        // Zeile mit vorheriger zusammenfuehren
        const next = [...lines];
        const prevLen = next[row - 1].length;
        next[row - 1] += next[row];
        next.splice(row, 1);
        setLines(next);
        setRow(row - 1);
        setCol(prevLen);
      }
      return;
    }

    // Navigation
    if (key.upArrow) {
      if (row > 0) {
        setRow(row - 1);
        setCol(Math.min(col, lines[row - 1].length));
      }
      return;
    }
    if (key.downArrow) {
      if (row < lines.length - 1) {
        setRow(row + 1);
        setCol(Math.min(col, lines[row + 1].length));
      }
      return;
    }
    if (key.leftArrow) {
      if (col > 0) {
        setCol(col - 1);
      } else if (row > 0) {
        setRow(row - 1);
        setCol(lines[row - 1].length);
      }
      return;
    }
    if (key.rightArrow) {
      if (col < lines[row].length) {
        setCol(col + 1);
      } else if (row < lines.length - 1) {
        setRow(row + 1);
        setCol(0);
      }
      return;
    }

    // Tab = 2 Leerzeichen
    if (key.tab) {
      const next = [...lines];
      next[row] = next[row].slice(0, col) + "  " + next[row].slice(col);
      setLines(next);
      setCol(col + 2);
      return;
    }

    // Normaler Text
    if (input && !key.ctrl && !key.meta) {
      const next = [...lines];
      next[row] = next[row].slice(0, col) + input + next[row].slice(col);
      setLines(next);
      setCol(col + input.length);
    }
  });

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
      {state === "confirm-exit" ? (
        <Text color={ACCENT.notes} bold>
          Speichern? [<Text color="#22c55e">Y/Enter</Text>=Ja  n=Nein  Esc=Zurueck]
        </Text>
      ) : (
        <Text color={ACCENT.muted}>Esc = Beenden  Enter = Neue Zeile</Text>
      )}
    </Box>
  );
}
