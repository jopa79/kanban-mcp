// Task-Detail-Ansicht
import React from "react";
import { Box, Text } from "ink";
import type { Task } from "../core/types.ts";
import { ACCENT, getColumnColor, getTagColor } from "./theme.ts";

interface DetailViewProps {
  task: Task;
}

export function DetailView({ task }: DetailViewProps) {
  const colColor = getColumnColor(task.columnId);

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color={ACCENT.title}>{task.title}</Text>
      <Box marginTop={0}>
        <Text color={ACCENT.muted}>ID: {task.id}</Text>
      </Box>
      <Box>
        <Text color={ACCENT.muted}>Spalte: </Text>
        <Text color={colColor}>{task.columnId}</Text>
      </Box>
      {task.isBlocked && <Text color="#ef4444" bold>BLOCKIERT</Text>}
      <Text color={ACCENT.muted}>Erstellt: {task.createdBy} @ {task.createdAt}</Text>
      {task.assignedTo && (
        <Text color={ACCENT.assignee}>Zugewiesen: @{task.assignedTo}</Text>
      )}
      <Box>
        <Text color={ACCENT.muted}>Beschreibung: </Text>
        <Text color={ACCENT.title}>{task.description ?? "—"}</Text>
      </Box>
      {task.labels.length > 0 && (
        <Box>
          <Text color={ACCENT.muted}>Tags: </Text>
          {task.labels.map((label, i) => (
            <Text key={label}>
              <Text color={getTagColor(label)}>{label}</Text>
              {i < task.labels.length - 1 && <Text color={ACCENT.muted}>, </Text>}
            </Text>
          ))}
        </Box>
      )}
      {task.notes && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color={ACCENT.notes}>Notizen:</Text>
          <Text color={ACCENT.title}>{task.notes}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={ACCENT.muted}>T=Titel  b=Beschreibung (Einzeiler)  e=Notizen (Freitext)  t=Tags  D=Deps  q/Esc=Zurueck</Text>
      </Box>
    </Box>
  );
}
