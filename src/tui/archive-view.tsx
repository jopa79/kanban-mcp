// Archiv-Ansicht — zeigt archivierte Tasks mit Restore/Delete-Optionen
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Task } from "../core/types.ts";
import { ACCENT, getColumnColor } from "./theme.ts";

interface ArchiveViewProps {
  tasks: Task[];
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onPurge: () => void;
  onBack: () => void;
}

export function ArchiveView({ tasks, onRestore, onDelete, onPurge, onBack }: ArchiveViewProps) {
  const [cursor, setCursor] = useState(0);
  const [confirmPurge, setConfirmPurge] = useState(false);

  useInput((input, key) => {
    // Purge-Bestaetigungsdialog
    if (confirmPurge) {
      if (input === "y") { onPurge(); setConfirmPurge(false); }
      else { setConfirmPurge(false); }
      return;
    }

    if (key.escape || input === "q") { onBack(); return; }
    if (key.upArrow) { setCursor(Math.max(0, cursor - 1)); return; }
    if (key.downArrow) { setCursor(Math.min(tasks.length - 1, cursor + 1)); return; }

    // R = Restore, x = einzeln loeschen, P = alle loeschen
    if (input === "R" && tasks.length > 0) { onRestore(tasks[cursor]!.id); setCursor(Math.min(cursor, tasks.length - 2)); }
    if (input === "x" && tasks.length > 0) { onDelete(tasks[cursor]!.id); setCursor(Math.min(cursor, tasks.length - 2)); }
    if (input === "P" && tasks.length > 0) { setConfirmPurge(true); }
  });

  if (tasks.length === 0) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold color={ACCENT.muted}>Archiv</Text>
        <Text color={ACCENT.muted}>Keine archivierten Tasks vorhanden.</Text>
        <Box marginTop={1}>
          <Text color={ACCENT.muted}>q/Esc = Zurueck</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color={ACCENT.muted}>Archiv ({tasks.length} Tasks)</Text>
      <Box flexDirection="column" marginTop={1}>
        {tasks.map((task, i) => {
          const isCursor = i === cursor;
          const shortId = task.id.slice(0, 8);
          return (
            <Box key={task.id}>
              <Text inverse={isCursor}>
                <Text color={ACCENT.muted}>[{shortId}] </Text>
                <Text color={ACCENT.title}>{task.title}</Text>
                <Text color={getColumnColor(task.columnId)}> ({task.columnId})</Text>
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        {confirmPurge
          ? <Text color={ACCENT.wipWarn}>Alle {tasks.length} archivierten Tasks loeschen? (y/n)</Text>
          : <Text color={ACCENT.muted}>R = Wiederherstellen  x = Loeschen  P = Alle loeschen  q/Esc = Zurueck</Text>
        }
      </Box>
    </Box>
  );
}
