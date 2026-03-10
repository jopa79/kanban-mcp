// Abhaengigkeiten-Ansicht fuer einen Task
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import type { Task } from "../core/types.ts";
import { ACCENT, getColumnColor } from "./theme.ts";

type DepsState = "list" | "add-input";

interface DependencyViewProps {
  task: Task;
  dependencies: Task[];
  dependents: Task[];
  onAdd: (dependsOnId: string) => void;
  onRemove: (dependsOnId: string) => void;
  onBack: () => void;
}

export function DependencyView({ task, dependencies, dependents, onAdd, onRemove, onBack }: DependencyViewProps) {
  const [state, setState] = useState<DepsState>("list");
  const [cursor, setCursor] = useState(0);
  const [addValue, setAddValue] = useState("");

  const allItems = dependencies;

  useInput((input, key) => {
    if (state === "add-input") return;

    if (key.escape || input === "q") {
      onBack();
      return;
    }

    if (key.upArrow && allItems.length > 0) {
      setCursor(Math.max(0, cursor - 1));
      return;
    }
    if (key.downArrow && allItems.length > 0) {
      setCursor(Math.min(allItems.length - 1, cursor + 1));
      return;
    }

    // a = Abhaengigkeit hinzufuegen
    if (input === "a") {
      setAddValue("");
      setState("add-input");
      return;
    }

    // x = Abhaengigkeit entfernen
    if (input === "x" && allItems.length > 0) {
      onRemove(allItems[cursor].id);
      setCursor(Math.max(0, cursor - 1));
    }
  });

  const handleAddSubmit = (val: string) => {
    if (val.trim()) {
      onAdd(val.trim());
    }
    setState("list");
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={ACCENT.labels} bold>Abhaengigkeiten: {task.title}</Text>

      {/* Blockiert durch */}
      <Box flexDirection="column" marginTop={1}>
        <Text color={ACCENT.wipWarn} bold>Blockiert durch ({dependencies.length}):</Text>
        {dependencies.length === 0 ? (
          <Text color={ACCENT.muted}>  Keine Abhaengigkeiten</Text>
        ) : (
          dependencies.map((dep, i) => {
            const isCursor = i === cursor;
            const shortId = dep.id.slice(0, 8);
            return (
              <Box key={dep.id}>
                <Text inverse={isCursor}>
                  <Text color={ACCENT.muted}>  [{shortId}] </Text>
                  <Text color={ACCENT.title}>{dep.title}</Text>
                  <Text color={getColumnColor(dep.columnId)}> ({dep.columnId})</Text>
                </Text>
              </Box>
            );
          })
        )}
      </Box>

      {/* Wird benoetigt von */}
      {dependents.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="#22c55e" bold>Wird benoetigt von ({dependents.length}):</Text>
          {dependents.map((dep) => {
            const shortId = dep.id.slice(0, 8);
            return (
              <Box key={dep.id}>
                <Text color={ACCENT.muted}>  [{shortId}] </Text>
                <Text color={ACCENT.title}>{dep.title}</Text>
                <Text color={getColumnColor(dep.columnId)}> ({dep.columnId})</Text>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Input fuer neue Abhaengigkeit */}
      {state === "add-input" && (
        <Box paddingTop={1}>
          <Text color={ACCENT.notes}>Task-ID: </Text>
          <TextInput value={addValue} onChange={setAddValue} onSubmit={handleAddSubmit} />
          <Text color={ACCENT.muted}>  (Enter=Hinzufuegen, Esc=Abbrechen)</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={ACCENT.muted}>a=Hinzufuegen  x=Entfernen  q/Esc=Zurueck</Text>
      </Box>
    </Box>
  );
}
