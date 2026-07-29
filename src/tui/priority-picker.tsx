// Prioritaets-Auswahl Komponente fuer die Kanban TUI (P2-3).
//
// Eigene Datei statt Erweiterung von status-bar.tsx: die vier Zustaende
// (high/medium/low/keine) sind eine Auswahl mit eigenem Cursor + eigenem
// useInput-Zyklus, kein simpler TextInput-Wrapper wie AddInput/TitleInput
// dort -- strukturell naeher an TagPicker (ebenfalls eigene Datei, eigener
// useInput) als an den Ein-Zeilen-Eingaben in status-bar.tsx.
//
// Radio-Marken "( )"/"(x)" statt der Checkbox-Marken "[ ]"/"[x]" aus
// TagPicker: Prioritaet ist Einfachauswahl (ein Wert von vieren), Tags sind
// Mehrfachauswahl -- die Konvention Klammer/Radio fuer Single-Select vs.
// eckige Klammer/Checkbox fuer Multi-Select ist etabliert und macht den
// Unterschied auf einen Blick klar, ohne zusaetzlichen Text zu brauchen.
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { TASK_PRIORITIES, type TaskPriority } from "../core/types.ts";
import { ACCENT, getPriorityColor, getPriorityLabel } from "./theme.ts";

interface PriorityPickerProps {
  selected: TaskPriority | null;
  onSave: (priority: TaskPriority | null) => void;
  onCancel: () => void;
}

// Reihenfolge: die drei echten Stufen (high zuerst, siehe TASK_PRIORITIES)
// plus "keine" (null) am Ende -- konsistent mit buildOrderBy() in
// task-service.ts, wo null beim Sortieren nach Prioritaet ebenfalls ans Ende faellt.
const OPTIONS: Array<TaskPriority | null> = [...TASK_PRIORITIES, null];

// Anzeige-Text je Option. Bewusst NICHT getPriorityLabel() fuer den
// null-Fall: dort steht "—" fuer "Feld ist leer" (Platzhalter in der
// Detailansicht), hier ist "Keine" eine aktiv waehlbare Menu-Option --
// zwei verschiedene Rollen, zwei verschiedene Texte.
function optionLabel(option: TaskPriority | null): string {
  return option === null ? "Keine" : getPriorityLabel(option);
}

export function PriorityPicker({ selected, onSave, onCancel }: PriorityPickerProps) {
  const [cursor, setCursor] = useState(() => {
    const idx = OPTIONS.indexOf(selected);
    return idx === -1 ? OPTIONS.length - 1 : idx;
  });

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      onSave(OPTIONS[cursor] ?? null);
      return;
    }

    if (key.upArrow) {
      setCursor(Math.max(0, cursor - 1));
      return;
    }
    if (key.downArrow) {
      setCursor(Math.min(OPTIONS.length - 1, cursor + 1));
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={ACCENT.labels} bold>Prioritaet auswaehlen:</Text>
      <Box flexDirection="column" borderStyle="single" paddingX={1}>
        {OPTIONS.map((option, i) => {
          const isCursor = i === cursor;
          const isCurrent = option === selected;
          const mark = isCurrent ? "(x)" : "( )";
          return (
            <Box key={option ?? "none"}>
              <Text inverse={isCursor}>
                <Text color={getPriorityColor(option)}>{mark} {optionLabel(option)}</Text>
              </Text>
            </Box>
          );
        })}
      </Box>
      <Text color={ACCENT.muted}>↑↓=Auswaehlen  Enter=Speichern  Esc=Abbrechen</Text>
    </Box>
  );
}
