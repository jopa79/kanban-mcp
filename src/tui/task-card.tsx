// Einzelne Task-Karte fuer die Board-Ansicht
import React from "react";
import { Box, Text } from "ink";
import type { Task } from "../core/types.ts";
import { ACCENT, getTagColor } from "./theme.ts";

interface TaskCardProps {
  task: Task;
  isSelected: boolean;
  isMoving?: boolean;
  columnColor: string;
}

export function TaskCard({ task, isSelected, isMoving, columnColor }: TaskCardProps) {
  // Verschiebe-Modus: gelber Rahmen als visuelles Feedback
  const borderColor = isMoving ? "#f59e0b" : isSelected ? "#ffffff" : columnColor;
  const borderStyle = isSelected || isMoving ? "bold" : "round";

  return (
    <Box
      flexDirection="column"
      borderStyle={borderStyle}
      borderColor={borderColor}
      paddingX={1}
      width="100%"
    >
      {/* Titel */}
      <Text bold color={isMoving ? "#f59e0b" : isSelected ? "#ffffff" : ACCENT.title} wrap="truncate">
        {isMoving ? "↔ " : ""}{task.title}
      </Text>

      {/* Beschreibung (Einzeiler) */}
      {task.description && (
        <Text color={ACCENT.muted} wrap="truncate">{task.description}</Text>
      )}

      {/* Meta-Zeile: Indikatoren */}
      <Box>
        {task.isBlocked && <Text color={ACCENT.wipWarn}>[B] </Text>}
        {task.hasNotes && <Text color={ACCENT.notes}>[N] </Text>}
        {task.assignedTo && (
          <Text color={ACCENT.assignee}>@{task.assignedTo} </Text>
        )}
        {task.labels.map((label) => (
          <Text key={label} color={getTagColor(label)}>{label} </Text>
        ))}
      </Box>
    </Box>
  );
}
