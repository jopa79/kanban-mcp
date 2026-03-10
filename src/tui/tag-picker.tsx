// Tag-Auswahl Komponente fuer die Kanban TUI
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { TAGS, ACCENT } from "./theme.ts";

interface TagPickerProps {
  selectedTags: string[];
  onSave: (tags: string[]) => void;
  onCancel: () => void;
}

export function TagPicker({ selectedTags, onSave, onCancel }: TagPickerProps) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set(selectedTags));

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      onSave([...selected]);
      return;
    }

    // Navigation
    if (key.upArrow) {
      setCursor(Math.max(0, cursor - 1));
      return;
    }
    if (key.downArrow) {
      setCursor(Math.min(TAGS.length - 1, cursor + 1));
      return;
    }

    // Space = Toggle
    if (input === " ") {
      const tag = TAGS[cursor].name;
      const next = new Set(selected);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      setSelected(next);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={ACCENT.labels} bold>Tags auswaehlen:</Text>
      <Box flexDirection="column" borderStyle="single" paddingX={1}>
        {TAGS.map((tag, i) => {
          const isSelected = selected.has(tag.name);
          const isCursor = i === cursor;
          const check = isSelected ? "[x]" : "[ ]";
          return (
            <Box key={tag.name}>
              <Text inverse={isCursor}>
                <Text color={tag.color}>{check} {tag.name}</Text>
              </Text>
            </Box>
          );
        })}
      </Box>
      <Text color={ACCENT.muted}>Space = Toggle  Enter = Speichern  Esc = Abbrechen</Text>
    </Box>
  );
}
