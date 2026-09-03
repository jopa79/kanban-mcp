// Statuszeile und Eingabe-Overlays
import React from "react";
import { Box, Text } from "ink";
import { LineInput } from "./line-input.tsx";
import type { Task } from "../core/types.ts";
import { ACCENT } from "./theme.ts";

// 'initialValue' statt 'value'/'onChange': der Eingabewert lebt seit #50
// (Plan .claude/plans/tui-input-flicker.md Schritt 2) in LineInput selbst,
// nicht mehr in app.tsx -- ein Tastendruck rendert damit nur noch diese
// Zeile, nicht das ganze Board. 'onCancel' ist optional und wird nur von
// Aufrufern gebraucht, die bei Esc eine eigene Aufraeum-Aktion brauchen
// (z.B. zurueck zur Detailansicht statt zum Board).
interface LineInputProps {
  initialValue?: string;
  onSubmit: (val: string) => void;
  onCancel?: () => void;
}

export function AddInput({ initialValue, onSubmit, onCancel }: LineInputProps) {
  return (
    <Box paddingX={1}>
      <Text color="#22c55e">Neuer Task: </Text>
      <LineInput initialValue={initialValue} onSubmit={onSubmit} onCancel={onCancel} />
      <Text color={ACCENT.muted}>  (Esc=Abbrechen)</Text>
    </Box>
  );
}

export function FilterInput({ initialValue, onSubmit, onCancel }: LineInputProps) {
  return (
    <Box paddingX={1}>
      <Text color={ACCENT.notes}>Filter: </Text>
      <LineInput initialValue={initialValue} onSubmit={onSubmit} onCancel={onCancel} />
      <Text color={ACCENT.muted}>  (Enter=Anwenden, leer=Aufheben)</Text>
    </Box>
  );
}

export function TitleInput({ initialValue, onSubmit, onCancel }: LineInputProps) {
  return (
    <Box paddingX={1}>
      <Text color={ACCENT.title}>Titel: </Text>
      <LineInput initialValue={initialValue} onSubmit={onSubmit} onCancel={onCancel} />
      <Text color={ACCENT.muted}>  (Enter=Speichern, Esc=Abbrechen)</Text>
    </Box>
  );
}

export function DescInput({ initialValue, onSubmit, onCancel }: LineInputProps) {
  return (
    <Box paddingX={1}>
      <Text color={ACCENT.notes}>Beschreibung: </Text>
      <LineInput initialValue={initialValue} onSubmit={onSubmit} onCancel={onCancel} />
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
export function ExportInput({ initialValue, onSubmit, onCancel }: LineInputProps) {
  return (
    <Box paddingX={1}>
      <Text color="#22c55e">Export-Pfad: </Text>
      <LineInput initialValue={initialValue} onSubmit={onSubmit} onCancel={onCancel} />
      <Text color={ACCENT.muted}>  (Enter=Exportieren, Esc=Abbrechen)</Text>
    </Box>
  );
}

// Import ZIP-Pfad Eingabe
export function ImportInput({ initialValue, onSubmit, onCancel }: LineInputProps) {
  return (
    <Box paddingX={1}>
      <Text color="#f59e0b">Import ZIP-Pfad: </Text>
      <LineInput initialValue={initialValue} onSubmit={onSubmit} onCancel={onCancel} />
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

interface OverrideConfirmProps {
  reason: string;
}

// Override-Bestaetigung fuer die Zustandsmaschine (P1-5, ADR 0002). Zeigt den
// VOLLEN Ablehnungstext von TransitionService -- blockierende Tasks, Standzeit,
// erreichtes Limit -- BEVOR der Ausweg angeboten wird. Ein Dialog, der das auf
// "Regel verletzt. Trotzdem? (y/n)" kuerzt, macht den Override zur
// Reflexbewegung (siehe ADR 0002, Begruendung).
export function OverrideConfirm({ reason }: OverrideConfirmProps) {
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text color={ACCENT.wipWarn}>{reason}</Text>
      <Text color={ACCENT.wipWarn} bold>Regel trotzdem brechen? (y/n)</Text>
    </Box>
  );
}

interface StatusBarProps {
  message: string;
}

// #51 (Taste "g"): "a=Arch.  A=Archiv" zu "a/A=Archiv" und "E=Export  I=Import"
// zu "E/I=Export/Import" gekuerzt, damit "g=Suche" dazukommt, ohne dass die
// Zeile laenger wird als vorher (126 Zeichen, unveraendert).
export function StatusBar({ message }: StatusBarProps) {
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Text color={ACCENT.muted}>
        ?=Hilfe  n=Neu  Space=Verschieben  f=Filter  g=Suche  t=Todo  d=Done  s=Sortieren  x=Del  a/A=Archiv  E/I=Export/Import  q=Quit
      </Text>
      {message && <Text color="#22c55e">{message}</Text>}
    </Box>
  );
}
