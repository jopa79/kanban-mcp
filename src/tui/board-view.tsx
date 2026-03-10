// Kanban Board Terminal-Ansicht mit Scroll-Support und Resize-Handling
import React, { useState, useEffect } from "react";
import { Box, Text, useStdout } from "ink";
import type { Column, Task } from "../core/types.ts";
import { TaskCard } from "./task-card.tsx";
import { getColumnColor, ACCENT } from "./theme.ts";

// Geschaetzte Hoehe pro Task-Karte (Titel + Meta + Borders)
const CARD_HEIGHT = 4;
// Overhead: App-Header + Spalten-Header + Spalten-Borders + Scroll-Indikatoren + StatusBar
const LAYOUT_OVERHEAD = 8;

interface BoardViewProps {
  columns: Column[];
  tasks: Task[];
  selectedCol: number;
  selectedRow: number;
  moving?: boolean;
}

// Sichtbares Fenster berechnen: haelt selectedRow im Viewport
function calcScrollWindow(totalItems: number, selectedIdx: number, maxVisible: number) {
  if (totalItems <= maxVisible) return { scrollTop: 0, visibleCount: totalItems };
  // Ausgewaehlten Task moeglichst mittig halten
  let scrollTop = Math.max(0, selectedIdx - Math.floor(maxVisible / 2));
  scrollTop = Math.min(scrollTop, totalItems - maxVisible);
  return { scrollTop, visibleCount: maxVisible };
}

export function BoardView({ columns, tasks, selectedCol, selectedRow, moving }: BoardViewProps) {
  const { stdout } = useStdout();
  // State fuer Terminal-Groesse — loest Re-Render bei Resize aus
  const [termRows, setTermRows] = useState(stdout?.rows ?? 24);

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => {
      // Screen leeren damit keine Artefakte bleiben
      stdout.write("\x1B[2J\x1B[3J\x1B[H");
      setTermRows(stdout.rows);
    };
    stdout.on("resize", onResize);
    return () => { stdout.off("resize", onResize); };
  }, [stdout]);

  const maxVisible = Math.max(2, Math.floor((termRows - LAYOUT_OVERHEAD) / CARD_HEIGHT));

  return (
    <Box flexDirection="row" width="100%">
      {columns.map((col, colIdx) => {
        const colTasks = tasks.filter(t => t.columnId === col.id);
        const color = getColumnColor(col.id);
        const isActiveCol = colIdx === selectedCol;

        // WIP-Limit Pruefung
        const isOverWip = col.wipLimit > 0 && colTasks.length > col.wipLimit;
        const headerColor = isOverWip ? ACCENT.wipWarn : color;

        // WIP-Anzeige: "In Progress (3/5)" oder "Todo (2)"
        const countLabel = col.wipLimit > 0
          ? `${colTasks.length}/${col.wipLimit}`
          : `${colTasks.length}`;

        // Scroll-Fenster: aktive Spalte folgt Cursor, andere zeigen ab oben
        const cursorIdx = isActiveCol ? selectedRow : 0;
        const { scrollTop, visibleCount } = calcScrollWindow(colTasks.length, cursorIdx, maxVisible);
        const visibleTasks = colTasks.slice(scrollTop, scrollTop + visibleCount);
        const hiddenAbove = scrollTop;
        const hiddenBelow = Math.max(0, colTasks.length - scrollTop - visibleCount);

        return (
          <Box
            key={col.id}
            flexDirection="column"
            width={Math.floor(100 / columns.length) + "%"}
            borderStyle={isActiveCol ? "bold" : "single"}
            borderColor={isActiveCol ? color : ACCENT.muted}
            paddingX={0}
          >
            {/* Spalten-Header */}
            <Box justifyContent="center" paddingY={0}>
              <Text bold color={headerColor}>
                {col.name}
              </Text>
              <Text color={isOverWip ? ACCENT.wipWarn : ACCENT.muted}>
                {" "}({countLabel})
              </Text>
            </Box>

            {/* Scroll-Indikator oben */}
            {hiddenAbove > 0 && (
              <Box justifyContent="center">
                <Text color={ACCENT.muted}>▲ {hiddenAbove} weitere</Text>
              </Box>
            )}

            {/* Tasks */}
            {colTasks.length === 0 ? (
              <Box paddingX={1} justifyContent="center">
                <Text color={ACCENT.muted}>keine Tasks</Text>
              </Box>
            ) : (
              visibleTasks.map((task, visIdx) => {
                const realIdx = scrollTop + visIdx;
                return (
                  <TaskCard
                    key={task.id}
                    task={task}
                    isSelected={isActiveCol && realIdx === selectedRow}
                    isMoving={moving && isActiveCol && realIdx === selectedRow}
                    columnColor={color}
                  />
                );
              })
            )}

            {/* Scroll-Indikator unten */}
            {hiddenBelow > 0 && (
              <Box justifyContent="center">
                <Text color={ACCENT.muted}>▼ {hiddenBelow} weitere</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
