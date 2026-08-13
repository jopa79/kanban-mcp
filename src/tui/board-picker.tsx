// Board-Auswahl fuer die TUI (P3-3): Liste aller registrierten Boards mit
// aggregierter Uebersicht (Status + Task-Zahl), analog zu 'kanban boards'.
// runBoardsList(), defaultRegistryDir() und readBoardOverview() liegen alle
// gemeinsam in cli/board-overview.ts (seit F1XuvRKOtNs5) und werden von hier
// bewusst wiederverwendet, nicht nachgebaut -- dort steckt bereits die Logik
// fuer "welches Board ist wie gesund" inkl. alter Randfaelle (kaputte
// config.json, gesperrte DB, Schema v2). board-overview.ts ist die geteilte
// Schicht fuer beide Oberflaechen: das CLI-Kommando 'kanban boards' nutzt
// sie ebenso wie diese Datei fuer den TUI-Board-Wechsel -- keine der beiden
// Oberflaechen importiert mehr aus der Commander-Verdrahtung der anderen.
//
// Aufgeteilt in zwei Teile fuer Testbarkeit (gleiches Prinzip wie
// use-board.ts, siehe Kommentar dort zu 'loadData'/'isOrphanTask'):
// BoardPickerList ist eine reine Praesentations-Komponente (Props -> Render,
// kein State, kein useInput) und direkt per renderToString() testbar wie
// DetailView/PriorityPicker. BoardPicker selbst haelt State (geladene
// Eintraege, Cursor) und die Tastatur-Kaskade -- beides ist ohne TTY nicht
// automatisiert pruefbar UND wuerde beim Rendern in einem Test die echte
// Registry lesen (defaultRegistryDir()) -- deshalb wird nur BoardPickerList
// getestet (siehe tests/board-picker.test.tsx), BoardPicker ist manuell zu
// verifizieren.
import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { runBoardsList, defaultRegistryDir, type BoardOverviewEntry, type BoardOverviewStatus } from "../cli/board-overview.ts";
import { ACCENT } from "./theme.ts";

const EMPTY_REGISTRY_HINT = "Keine Boards registriert. 'kanban boards add' im Terminal ausfuehren.";
// Mindestbreite der Namensspalte, falls kein Eintrag laenger ist -- gleicher
// Wert wie in formatBoardsList() (cli/formatters.ts), aus Konsistenzgruenden
// wiederverwendet statt einer eigenen, abweichenden Zahl.
const MIN_NAME_COLUMN_WIDTH = 4;

// Ob ein Eintrag ausgewaehlt werden darf. Nur 'ok' oeffnet ein Board wirklich --
// 'missing'/'schema-outdated'/'error' zeigen stattdessen eine Meldung (siehe
// blockedMessageFor). Der eigentliche Schutz bleibt assertSchemaCurrent() in
// db.ts; dieser Check verhindert nur, dass der Versuch ueberhaupt gestartet
// wird -- kein Umgehen des Guards, sondern ein Vermeiden des Aufrufs.
function isSelectable(status: BoardOverviewStatus): status is Extract<BoardOverviewStatus, { kind: "ok" }> {
  return status.kind === "ok";
}

// Verstaendliche Meldung fuer einen Eintrag, der sich nicht oeffnen laesst.
// Nur fuer Nicht-'ok'-Status aufgerufen (siehe Aufrufer in BoardPicker) --
// 'Exclude' spart einen toten 'ok'-Zweig, der ohnehin nie erreicht wird.
function blockedMessageFor(status: Exclude<BoardOverviewStatus, { kind: "ok" }>): string {
  if (status.kind === "missing") return "Pfad existiert nicht mehr.";
  if (status.kind === "schema-outdated") return `Schema v${status.version} — 'kanban migrate' noetig.`;
  return status.message;
}

// Statuszeile je Board fuer die Anzeige -- Text + Farbe, inhaltlich analog zu
// formatBoardStatus() in cli/formatters.ts, aber fuer Ink-Text statt rohem
// ANSI (Ink faerbt selbst; eingebettete ANSI-Codes in einem <Text> wuerden
// Inks eigenes Farb-Handling durchkreuzen).
function statusLabel(status: BoardOverviewStatus): { text: string; color: string } {
  if (status.kind === "ok") return { text: `${status.taskCount} Tasks`, color: ACCENT.muted };
  if (status.kind === "missing") return { text: "⚠ Pfad existiert nicht mehr", color: ACCENT.wipWarn };
  if (status.kind === "schema-outdated") return { text: `⚠ Schema v${status.version} — Migration noetig`, color: ACCENT.wipWarn };
  return { text: `⚠ ${status.message}`, color: ACCENT.wipWarn };
}

interface BoardPickerListProps {
  entries: BoardOverviewEntry[];
  currentPath: string;
  cursor: number;
  blockedMsg: string;
}

// Reine Darstellung -- keine Effekte, kein useInput. Direkt per
// renderToString() testbar (siehe tests/board-picker.test.tsx).
export function BoardPickerList({ entries, currentPath, cursor, blockedMsg }: BoardPickerListProps) {
  const nameWidth = Math.max(MIN_NAME_COLUMN_WIDTH, ...entries.map((e) => e.name.length));

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      <Text bold color={ACCENT.title}>Board wechseln</Text>
      {entries.length === 0 && <Text color={ACCENT.muted}>{EMPTY_REGISTRY_HINT}</Text>}
      {entries.map((entry, i) => {
        const isCursor = i === cursor;
        const isCurrent = entry.path === currentPath;
        const selectable = isSelectable(entry.status);
        const label = statusLabel(entry.status);
        return (
          <Box key={entry.path}>
            <Text inverse={isCursor} color={selectable ? ACCENT.title : ACCENT.muted}>
              {isCurrent ? "▸ " : "  "}{entry.name.padEnd(nameWidth)}
            </Text>
            <Text inverse={isCursor}>{"  "}</Text>
            <Text inverse={isCursor} color={label.color}>{label.text}</Text>
          </Box>
        );
      })}
      {blockedMsg && <Text color={ACCENT.wipWarn}>{blockedMsg}</Text>}
      <Text color={ACCENT.muted}>↑↓ Auswaehlen  Enter Wechseln  Esc Zurueck</Text>
    </Box>
  );
}

interface BoardPickerProps {
  currentPath: string;
  onSelect: (entry: BoardOverviewEntry) => void;
  onCancel: () => void;
}

// Zustandsbehaftete Huelle: laedt die Registry-Uebersicht bei jedem Mount neu.
// Die Komponente wird in app.tsx bedingt gemountet/entmountet (mode ===
// "board-picker") -- ein erneutes Druecken von 'B' erzeugt also automatisch
// eine frische Instanz samt frischem Ladevorgang, kein eigener Refresh-Key
// noetig.
export function BoardPicker({ currentPath, onSelect, onCancel }: BoardPickerProps) {
  const [entries, setEntries] = useState<BoardOverviewEntry[]>([]);
  const [cursor, setCursor] = useState(0);
  const [blockedMsg, setBlockedMsg] = useState("");

  useEffect(() => {
    setEntries(runBoardsList(defaultRegistryDir()));
  }, []);

  useInput((input, key) => {
    if (key.escape) { onCancel(); return; }
    if (entries.length === 0) return;
    if (key.upArrow) { setCursor((c) => Math.max(0, c - 1)); setBlockedMsg(""); return; }
    if (key.downArrow) { setCursor((c) => Math.min(entries.length - 1, c + 1)); setBlockedMsg(""); return; }
    if (key.return) {
      const entry = entries[cursor];
      if (!entry) return;
      if (isSelectable(entry.status)) { onSelect(entry); return; }
      setBlockedMsg(blockedMessageFor(entry.status));
    }
  });

  return <BoardPickerList entries={entries} currentPath={currentPath} cursor={cursor} blockedMsg={blockedMsg} />;
}
