// Statuszeile und Eingabe-Overlays
import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
import type { Task } from "../core/types.ts";
import { ACCENT } from "./theme.ts";

interface AddInputProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
}

export function AddInput({ value, onChange, onSubmit }: AddInputProps) {
  return (
    <Box paddingX={1}>
      <Text color="#22c55e">Neuer Task: </Text>
      <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
      <Text color={ACCENT.muted}>  (Esc=Abbrechen)</Text>
    </Box>
  );
}

interface FilterInputProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
}

export function FilterInput({ value, onChange, onSubmit }: FilterInputProps) {
  return (
    <Box paddingX={1}>
      <Text color={ACCENT.notes}>Filter: </Text>
      <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
      <Text color={ACCENT.muted}>  (Enter=Anwenden, leer=Aufheben)</Text>
    </Box>
  );
}

interface TitleInputProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
}

export function TitleInput({ value, onChange, onSubmit }: TitleInputProps) {
  return (
    <Box paddingX={1}>
      <Text color={ACCENT.title}>Titel: </Text>
      <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
      <Text color={ACCENT.muted}>  (Enter=Speichern, Esc=Abbrechen)</Text>
    </Box>
  );
}

interface DescInputProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: (val: string) => void;
}

export function DescInput({ value, onChange, onSubmit }: DescInputProps) {
  return (
    <Box paddingX={1}>
      <Text color={ACCENT.notes}>Beschreibung: </Text>
      <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
      <Text color={ACCENT.muted}>  (Enter=Speichern, leer=Loeschen)</Text>
    </Box>
  );
}

interface DeleteConfirmProps {
  task: Task;
}

export function DeleteConfirm({ task }: DeleteConfirmProps) {
  return (
    <Box paddingX={1}>
      <Text color={ACCENT.wipWarn}>"{task.title}" loeschen? (y/n)</Text>
    </Box>
  );
}

// Export-Pfad Eingabe
export function ExportInput({ value, onChange, onSubmit }: AddInputProps) {
  return (
    <Box paddingX={1}>
      <Text color="#22c55e">Export-Pfad: </Text>
      <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
      <Text color={ACCENT.muted}>  (Enter=Exportieren, Esc=Abbrechen)</Text>
    </Box>
  );
}

// Import ZIP-Pfad Eingabe
export function ImportInput({ value, onChange, onSubmit }: AddInputProps) {
  return (
    <Box paddingX={1}>
      <Text color="#f59e0b">Import ZIP-Pfad: </Text>
      <TextInput value={value} onChange={onChange} onSubmit={onSubmit} />
      <Text color={ACCENT.muted}>  (Enter=Importieren, Esc=Abbrechen)</Text>
    </Box>
  );
}

// Import-Bestaetigungsdialog
export function ImportConfirm() {
  return (
    <Box paddingX={1}>
      <Text color={ACCENT.wipWarn}>Board wird ueberschrieben! Fortfahren? (y/n)</Text>
    </Box>
  );
}

interface StatusBarProps {
  message: string;
}

export function StatusBar({ message }: StatusBarProps) {
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Text color={ACCENT.muted}>
        ?=Hilfe  n=Neu  Space=Verschieben  /=Filter  t=Todo  d=Done  x=Del  a=Arch.  A=Archiv  E=Export  I=Import  q=Quit
      </Text>
      {message && <Text color="#22c55e">{message}</Text>}
    </Box>
  );
}
