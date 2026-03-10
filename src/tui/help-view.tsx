// Hilfe-Overlay mit Tastaturkuerzeln
import React from "react";
import { Box, Text } from "ink";
import { ACCENT } from "./theme.ts";

const SHORTCUTS = [
  { key: "Pfeiltasten", desc: "Zwischen Spalten/Tasks navigieren" },
  { key: "Enter", desc: "Task-Details anzeigen" },
  { key: "n", desc: "Neuen Task in aktiver Spalte erstellen" },
  { key: "Space", desc: "Verschiebe-Modus (Pfeiltasten bewegen Task)" },
  { key: "t", desc: "Task von Backlog nach Todo verschieben" },
  { key: "d", desc: "Task als Done markieren" },
  { key: "x", desc: "Task loeschen (mit Bestaetigung)" },
  { key: "a", desc: "Task archivieren" },
  { key: "A", desc: "Archiv anzeigen" },
  { key: "E", desc: "Board als ZIP exportieren" },
  { key: "I", desc: "Board aus ZIP importieren" },
  { key: "/", desc: "Tasks nach Titel filtern" },
  { key: "Esc", desc: "Filter aufheben / Zurueck" },
  { key: "r", desc: "Board neu laden" },
  { key: "?", desc: "Diese Hilfe anzeigen" },
  { key: "q", desc: "TUI beenden" },
  { key: "", desc: "" },
  { key: "Detail-Ansicht", desc: "" },
  { key: "b", desc: "Beschreibung editieren (Einzeiler)" },
  { key: "e", desc: "Notizen editieren (Freitext, mehrzeilig)" },
  { key: "t", desc: "Tags/Labels bearbeiten" },
  { key: "T", desc: "Titel editieren" },
  { key: "D", desc: "Abhaengigkeiten verwalten" },
];

export function HelpView() {
  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="#3b82f6"> Tastaturkuerzel</Text>
      <Text> </Text>
      {SHORTCUTS.map(({ key, desc }) => (
        <Box key={key} paddingX={1}>
          <Box width={16}>
            <Text bold color={ACCENT.notes}>{key}</Text>
          </Box>
          <Text color={ACCENT.title}>{desc}</Text>
        </Box>
      ))}
      <Text> </Text>
      <Text color={ACCENT.muted}>q/Esc = Zurueck zum Board</Text>
    </Box>
  );
}
