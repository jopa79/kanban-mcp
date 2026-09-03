// Sprung-Suchmodus der TUI (Taste "g", GitHub #51, Plan
// .claude/plans/tui-search-jump.md, Abschnitt 5).
//
// Zwei Komponenten wie bei BoardPicker/BoardPickerList (board-picker.tsx):
// 'SearchResultList' ist reine Darstellung (Props -> Render, kein State, kein
// useInput) und direkt per renderToString() testbar (siehe
// tests/search-view.test.tsx). 'SearchView' haelt State und die
// useInput()-Kaskade -- ohne TTY nicht automatisiert pruefbar, siehe
// tests/tui-search.test.ts (T4).
//
// KEIN Rahmen/Padding um die Trefferzeilen: renderToString() liefert kein
// ANSI, also ist die inverse Cursor-Darstellung allein nicht testbar (siehe
// Plan, Review Runde 2/4). Nur das sichtbare Zeichen "> " am Zeilenanfang
// ist pruefbar -- ein borderStyle/paddingX um die Liste wuerde jede Zeile um
// Rahmen- bzw. Padding-Zeichen verschieben und "> "/"  " nicht mehr an
// Position 0 stehen lassen (gemessen beim Bau dieser Datei).
import React, { useRef, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { Column, Task } from "../core/types.ts";
import { ORPHAN_COLUMN_ID } from "../core/types.ts";
import { NotesService } from "../core/notes-service.ts";
import { isOrphanTask } from "./use-board.ts";
import { calcScrollWindow } from "./board-view.tsx";
import { LineInputDisplay, initLineInputState, reduceLineInput, type LineInputState } from "./line-input.tsx";
import { buildSearchIndex, parseSearchQuery, searchTasks, type SearchEntry } from "./search-query.ts";
import { getColumnColor, ACCENT } from "./theme.ts";

// Layout-Overhead fuer 'maxVisible' (Plan Abschnitt 5): Titelzeile (1),
// Eingabezeile (1), Fusszeile (1), Reserve fuer Scroll-Indikatoren + die aus
// app.tsx uebernommene Randzeile (3). Ein Fehler hier kostet nur eine Zeile
// Anzeige, nie ein Flackern -- die Korrektheit haengt allein an
// 'height={rows - 1}' unten (Blocker A aus dem Review).
const SEARCH_LAYOUT_OVERHEAD = 6;
const MIN_VISIBLE_HITS = 1;

// Kurz-ID wie in dependency-view.tsx (8 Zeichen).
const SHORT_ID_LENGTH = 8;

const NO_HITS_LABEL = "Keine Treffer";
const INVALID_DUE_HINT = "Ungueltiges Datum, erwartet JJJJ-MM oder JJJJ-MM-TT";
const FOOTER_HINT = "↑↓ Auswaehlen  Enter Springen  Esc Zurueck";

// Anzeige-Spalte eines Treffers -- dieselbe Waisen-Regel wie in app.tsx,
// board-view.tsx und search-query.ts (siehe dortiger Kommentar zu
// 'belongsToColumn'). Eine Zusammenfuehrung der jetzt vier Stellen ist ein
// spaeterer Refactor, nicht Teil dieses Features (Plan Abschnitt 5).
function findDisplayColumn(task: Task, displayColumns: Column[], columns: Column[]): Column | undefined {
  return displayColumns.find((col) =>
    col.id === ORPHAN_COLUMN_ID ? isOrphanTask(task, columns) : task.columnId === col.id
  );
}

interface SearchResultListProps {
  inputState: LineInputState;
  hits: Task[];
  cursor: number;
  invalidDue: string | null; // query.due.kind === "invalid" ? raw : null
  displayColumns: Column[];
  columns: Column[];
  maxVisible: number;
}

// Reine Darstellung -- keine Effekte, kein useInput.
export function SearchResultList({ inputState, hits, cursor, invalidDue, displayColumns, columns, maxVisible }: SearchResultListProps) {
  const { scrollTop, visibleCount } = calcScrollWindow(hits.length, cursor, maxVisible);
  const visibleHits = hits.slice(scrollTop, scrollTop + visibleCount);
  const hiddenAbove = scrollTop;
  const hiddenBelow = Math.max(0, hits.length - scrollTop - visibleCount);

  return (
    <Box flexDirection="column">
      <Text bold color={ACCENT.title}>Suche</Text>
      <Box>
        <Text color={ACCENT.notes}>Suche: </Text>
        <LineInputDisplay state={inputState} />
      </Box>
      {invalidDue !== null ? (
        <Text color={ACCENT.wipWarn}>{INVALID_DUE_HINT}</Text>
      ) : hits.length === 0 ? (
        <Text color={ACCENT.muted}>{NO_HITS_LABEL}</Text>
      ) : (
        <Box flexDirection="column">
          {hiddenAbove > 0 && <Text color={ACCENT.muted}>▲ {hiddenAbove} weitere</Text>}
          {visibleHits.map((task, visIdx) => {
            const realIdx = scrollTop + visIdx;
            const isCursor = realIdx === cursor;
            const col = findDisplayColumn(task, displayColumns, columns);
            const colColor = col ? getColumnColor(col.id) : ACCENT.muted;
            const shortId = task.id.slice(0, SHORT_ID_LENGTH);
            return (
              <Box key={task.id}>
                <Text inverse={isCursor}>{isCursor ? "> " : "  "}</Text>
                <Text inverse={isCursor} color={colColor}>{col?.name ?? ""}</Text>
                <Text inverse={isCursor} color={ACCENT.muted}> [{shortId}] </Text>
                <Text inverse={isCursor} color={ACCENT.title}>{task.title}</Text>
                {task.dueDate && <Text inverse={isCursor} color={ACCENT.notes}> Faellig: {task.dueDate}</Text>}
              </Box>
            );
          })}
          {hiddenBelow > 0 && <Text color={ACCENT.muted}>▼ {hiddenBelow} weitere</Text>}
        </Box>
      )}
      <Text color={ACCENT.muted}>{FOOTER_HINT}</Text>
    </Box>
  );
}

interface SearchViewProps {
  tasks: Task[];
  displayColumns: Column[];
  columns: Column[];
  kanbanDir: string;
  onSelect: (task: Task) => void;
  onCancel: () => void;
}

// Zustandsbehaftete Huelle: haelt Eingabewert (Ref-Muster wie LineInput) und
// Listen-Cursor, registriert die Tastatur-Kaskade.
export function SearchView({ tasks, displayColumns, columns, kanbanDir, onSelect, onCancel }: SearchViewProps) {
  const { stdout } = useStdout();
  const rows = stdout?.rows ?? 24;

  // Suchindex EINMAL beim Mount, per Lazy-Init (Blocker B aus dem Review,
  // Plan Abschnitt 5) -- NICHT useRef(buildSearchIndex(...)), das wuerde den
  // Dateizugriff fuer Notizen bei JEDEM Render wiederholen, React verwirft
  // nur das Ergebnis.
  const indexRef = useRef<SearchEntry[] | null>(null);
  if (indexRef.current === null) {
    const notes = new NotesService(kanbanDir);
    indexRef.current = buildSearchIndex(tasks, (id) => notes.load(id));
  }
  const index = indexRef.current;

  // Eingabewert + Cursor im Ref, wie LineInput (Ref ist die Quelle der
  // Wahrheit, State loest nur Rendern aus) -- kein onChange nach aussen,
  // sonst kommen die Board-weiten Rerenders aus #50 zurueck.
  const inputRef = useRef<LineInputState>(initLineInputState(""));
  const [inputState, setInputState] = useState<LineInputState>(inputRef.current);
  const [listCursor, setListCursor] = useState(0);

  const query = parseSearchQuery(inputState.value);
  const hits = searchTasks(index, query, displayColumns, columns);
  const invalidDue = query.due.kind === "invalid" ? query.due.raw : null;

  const maxVisible = Math.max(MIN_VISIBLE_HITS, rows - SEARCH_LAYOUT_OVERHEAD);

  useInput((input, key) => {
    // 1. Pfeil hoch/runter bewegen den Listen-Cursor -- VOR
    // reduceLineInput(), das diese Tasten sonst mit action:"none" wirkungslos
    // durchreicht (Plan Abschnitt 3, verbindliche Reihenfolge).
    if (key.upArrow) { setListCursor((c) => Math.max(0, c - 1)); return; }
    if (key.downArrow) { setListCursor((c) => Math.min(Math.max(0, hits.length - 1), c + 1)); return; }

    // 2. Alles andere durch reduceLineInput().
    const prev = inputRef.current;
    const { state: next, action } = reduceLineInput(prev, input, key);
    inputRef.current = next;
    setInputState(next);

    // 3. Listen-Cursor nur zuruecksetzen, wenn sich der Wert AENDERT --
    // Pfeil links/rechts/Home/End aendern den Wert nicht und lassen den
    // Listen-Cursor stehen.
    if (next.value !== prev.value) setListCursor(0);

    if (action === "submit") {
      const selected = hits[listCursor];
      if (selected !== undefined) onSelect(selected);
    } else if (action === "cancel") {
      onCancel();
    }
  });

  // Vollbild-Hoehe wie der Board-Zweig in app.tsx (Blocker A aus dem Review):
  // NUR mit 'height={rows - 1}' + 'overflow="hidden"' bleibt die Ausgabe
  // unter stdout.rows und Ink faellt nicht in seinen Vollbild-Pfad (ESC[2J
  // bei jedem Tastendruck). board-picker.tsx ist hier KEIN Vorbild -- der hat
  // keine Hoehenbegrenzung.
  return (
    <Box flexDirection="column" height={rows - 1} overflow="hidden">
      <SearchResultList
        inputState={inputState}
        hits={hits}
        cursor={listCursor}
        invalidDue={invalidDue}
        displayColumns={displayColumns}
        columns={columns}
        maxVisible={maxVisible}
      />
    </Box>
  );
}
