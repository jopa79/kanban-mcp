# Plan: TUI — Sprung-Suchmodus (Taste `f`)

GitHub: #51. Stand: 2026-09-03. Verfasst vom Planer. Grundlage: Brainstorming mit JoPa
(abgeschlossen, nicht neu verhandeln) und Code-Analyse von `src/tui/`.

## 1. Ziel

Taste `f` im Board-Modus öffnet einen Suchmodus. JoPa tippt einen Suchtext.
Die Trefferliste aktualisiert sich bei jeder Taste. Enter springt mit dem
Cursor auf den Treffer im Board. Esc bricht ab.

Erfolgsbild ist Geschwindigkeit: einen bekannten Task schnell wiederfinden.
Der bestehende Filter (`/`) grenzt das Board ein. Die Suche springt hin.
Das sind zwei Werkzeuge, kein Ersatz.

## 2. Befund aus dem Code

### 2.1 Notizen liegen nicht in `board.tasks`

`TaskService.listTasks()` (`src/core/task-service.ts:162`) setzt nur
`hasNotes`. Den Text lädt nur `getTask()`. Die Suche muss Notizen deshalb
selbst nachladen. `board.kanbanDir` ist in `app.tsx` verfügbar,
`NotesService(kanbanDir).load(id)` liest eine Datei synchron.

Entscheidung: Beim Mount des Suchmodus einmal alle Notizen der Tasks mit
`hasNotes === true` laden und einen Suchindex bauen. Kein Nachladen pro
Tastendruck. `listTasks()` bleibt unverändert, sonst wächst jede
CLI- und MCP-Antwort um alle Notiztexte.

### 2.2 `LineInput` meldet den Wert nur bei Enter

`src/tui/line-input.tsx` hat nur `onSubmit`/`onCancel`. Ein `onChange` pro
Taste würde den Wert wieder nach außen tragen. Genau das hat der Flicker-Fix
(#50) beseitigt.

Entscheidung: Kein `onChange`. Der Suchmodus hält den Eingabewert selbst im
Ref, wie `LineInput`, und nutzt dafür die exportierte reine Funktion
`reduceLineInput()`. Die Trefferliste rendert innerhalb derselben kleinen
Komponente. Ein Tastendruck rendert nur die Suchansicht, nie das Board.
Damit `LineInput` und Suchmodus den Cursor gleich zeichnen, wird die
Darstellung aus `LineInput` in eine Präsentations-Komponente
`LineInputDisplay({ state, mask })` herausgelöst. `LineInput` nutzt sie
weiter, die Schnittstelle von `LineInput` bleibt gleich.

### 2.3 Vollbild statt Footer

`BoardPicker` (`src/tui/board-picker.tsx`) ersetzt das Board komplett
(`if (mode === "board-picker") return <BoardPicker/>`). Der Suchmodus macht
das genauso. Grund: Die Trefferliste braucht Höhe. Ein Footer-Overlay unter
dem Board würde bei jeder Taste das Board mit rendern.

### 2.4 Cursor-Position des Treffers

`app.tsx` berechnet die Zeile aus `filteredTasks` (Titel-Filter aus `/`).
Ein Treffer, den der Filter verbirgt, hat dort keine Zeile.

Entscheidung: Der Sprung hebt den Filter auf (`setFilterText("")`). Die
Zeile wird gegen `board.tasks` berechnet. `board.tasks` ist bereits in der
Reihenfolge sortiert, die das Board zeigt (`effectiveSort` läuft durch
`useBoard`). Die Spalte kommt aus `board.displayColumns`, für Waisen über
`isOrphanTask()` auf den Index der Sammelspalte.

Im Verschiebe-Modus ist `f` unerreichbar. Der Block `if (moving &&
selectedTask)` in `use-input-modes.ts` kehrt vorher zurück. Das ist gewollt.

### 2.5 `app.tsx` liegt schon über der Stoppgrenze

`app.tsx` hat 432 Zeilen. Die Grenze aus den Task-Notes ist 420. Die
Suche fügt dort nur einen Modus-Zweig hinzu (etwa 8 Zeilen). Alle Logik
liegt in neuen Dateien. Ein eigener Refactoring-Task (T5) bringt `app.tsx`
wieder unter die Grenze. Er ist nicht Teil dieses Features.

## 3. Umfang

### Durchsuchte Felder

`title`, `description`, `notes`, `task.id`. Alles in Kleinschreibung
verglichen. `#NN`-Referenzen im Titel treffen über den Titel-Volltext.
Kurz-IDs (8 Zeichen, wie in `dependency-view.tsx`) treffen als Substring
der vollen ID.

Nicht durchsucht: `createdAt`, Labels, `assignedTo`, archivierte Tasks.

### Syntax

- Eingabe wird an Leerzeichen in Tokens zerlegt.
- Token mit Präfix `faellig:` oder `fällig:` ist ein Datumsfilter. Erlaubt:
  `JJJJ-MM` und `JJJJ-MM-TT`. Abgleich mit `dueDate.startsWith(wert)`.
  Task ohne `dueDate` trifft nie.
- Alle übrigen Tokens sind Texttokens. Jedes Texttoken muss in mindestens
  einem Feld vorkommen (UND-Verknüpfung über Tokens).
- Der Datumsfilter darf an jeder Stelle stehen. Stehen mehrere, gilt der
  letzte.
- Ungültiger Datumswert (z.B. `faellig:morgen`): leere Liste plus Hinweis
  "Ungueltiges Datum, erwartet JJJJ-MM oder JJJJ-MM-TT". Kein Fehler.
- Leere Eingabe: alle Tasks in Board-Reihenfolge. So dient `f` auch als
  reine Sprungliste.

### Trefferliste

- Reihenfolge: nach `displayColumns`, innerhalb der Spalte wie im Board.
- Zeile je Treffer: Spaltenname in Spaltenfarbe (`getColumnColor`), Kurz-ID
  (8 Zeichen, `ACCENT.muted`), Titel, `dueDate` falls gesetzt.
- Waisen zeigen den Namen der Sammelspalte ("⚠ Ohne Spalte").
- Cursor: inverse Zeile, wie `BoardPickerList`.
- Scroll-Fenster hält den Cursor sichtbar. `calcScrollWindow()` aus
  `board-view.tsx` wird exportiert und wiederverwendet.
- Kein Treffer: "Keine Treffer".
- Fußzeile: "↑↓ Auswaehlen  Enter Springen  Esc Zurueck".

### Tasten im Suchmodus

- Zeichen, Backspace, Pfeil links/rechts, Home/End: `reduceLineInput()`.
  Nach jeder Textänderung springt der Listen-Cursor auf 0.
- Pfeil hoch/runter: Listen-Cursor.
- Enter: `onSelect(treffer)`. Bei leerer Liste passiert nichts.
- Esc: `onCancel()`.

### Nach dem Sprung (`handleSearchSelect` in `app.tsx`)

1. `setFilterText("")`
2. `setSelectedCol(col)`, `setSelectedRow(row)`
3. `setStatusMsg(\`Sprung: "${task.title}"\`)`
4. `setMode("board")`

Die Detailansicht öffnet sich NICHT automatisch. Enter im Board bleibt der
Weg dorthin. Entschieden von JoPa, siehe Abschnitt 8.

Findet `locateTask()` den Task nicht mehr (zwischenzeitlich gelöscht oder
archiviert): `setStatusMsg("Task nicht mehr auf dem Board")`, zurück zum
Board ohne Cursor-Änderung.

### Nicht dabei

Gespeicherte Suchen, Kalender-Picker, Treffer pro Spalte, Suche über
`createdAt`, Suche im Archiv.

## 4. Dateien

| Datei | Änderung |
|---|---|
| `src/tui/search-query.ts` | NEU. Reine Funktionen: `parseSearchQuery`, `buildSearchIndex`, `matchesQuery`, `searchTasks`, `locateTask`. Kein React. |
| `src/tui/search-view.tsx` | NEU. `SearchResultList` (rein, Props → Render) und `SearchView` (State + `useInput`). |
| `src/tui/line-input.tsx` | `LineInputDisplay` herauslösen und exportieren. Verhalten unverändert. |
| `src/tui/board-view.tsx` | `calcScrollWindow` exportieren. Sonst unverändert. |
| `src/tui/use-input-modes.ts` | `Mode` um `"search"` erweitern. Im Board-Block: `if (input === "f") { setMode("search"); }`. Im Frühausstieg der Texteingabe-Modi `"search"` ergänzen, sonst reagieren zwei Handler. |
| `src/tui/app.tsx` | Import, `if (mode === "search") return <SearchView .../>` neben dem BoardPicker-Zweig, `handleSearchSelect`, `handleSearchCancel`. Maximal +12 Zeilen. |
| `src/tui/help-view.tsx` | Eintrag `{ key: "f", desc: "Task suchen und hinspringen" }` nach `/`. |
| `src/tui/status-bar.tsx` | `f=Suche` in der Fußzeile nach `/=Filter`. |
| `tests/search-query.test.ts` | NEU. |
| `tests/search-view.test.tsx` | NEU. `renderToString` von `SearchResultList`. |
| `tests/tui-search.test.ts` | NEU. Mount-Test mit Fake-TTY. |

## 5. Schnittstellen

```ts
// src/tui/search-query.ts
export interface SearchQuery {
  textTerms: string[];          // bereits kleingeschrieben
  duePrefix: string | null;     // "2026-09" oder "2026-09-03"
  invalidDue: string | null;    // roher Wert, wenn Format falsch
}
export function parseSearchQuery(raw: string): SearchQuery;

export interface SearchEntry {
  task: Task;
  haystack: string;             // title + description + notes + id, kleingeschrieben
}
// loadNotes wird injiziert, damit der Index ohne Dateisystem testbar ist.
export function buildSearchIndex(
  tasks: Task[],
  loadNotes: (taskId: string) => string | null,
): SearchEntry[];

export function matchesQuery(entry: SearchEntry, query: SearchQuery): boolean;

// Treffer in Board-Reihenfolge: nach displayColumns, dann Reihenfolge in 'tasks'.
export function searchTasks(
  index: SearchEntry[],
  query: SearchQuery,
  displayColumns: Column[],
  columns: Column[],
): Task[];

// Spalte + Zeile des Tasks im Board. null, wenn er nicht (mehr) auf dem Board ist.
export function locateTask(
  taskId: string,
  tasks: Task[],
  displayColumns: Column[],
  columns: Column[],
): { col: number; row: number } | null;
```

```tsx
// src/tui/search-view.tsx
interface SearchResultListProps {
  inputState: LineInputState;
  hits: Task[];
  cursor: number;
  invalidDue: string | null;
  displayColumns: Column[];
  columns: Column[];
  maxVisible: number;
}
export function SearchResultList(props: SearchResultListProps): JSX.Element;

interface SearchViewProps {
  tasks: Task[];
  displayColumns: Column[];
  columns: Column[];
  kanbanDir: string;
  onSelect: (task: Task) => void;
  onCancel: () => void;
}
export function SearchView(props: SearchViewProps): JSX.Element;
```

`SearchView` intern:

- `indexRef = useRef(buildSearchIndex(tasks, (id) => new NotesService(kanbanDir).load(id)))`
  einmal beim Mount. `tasks` ändert sich während der Suche nur durch den
  Watcher. Das ist akzeptabel: die Liste zeigt dann den Stand beim Öffnen,
  `locateTask` beim Sprung prüft gegen den aktuellen Stand.
- `inputRef` + `useState` für `LineInputState`, exakt das Muster aus
  `LineInput` (Ref ist die Quelle der Wahrheit, State löst nur Rendern aus).
- `hits = useMemo(() => searchTasks(index, parseSearchQuery(input.value), ...), [input.value, ...])`.
- `maxVisible` aus `useStdout().rows` minus Kopf/Fuß (Konstante, analog
  `LAYOUT_OVERHEAD`).

Die Spalten-Zugehörigkeit (`activeColumn.id === ORPHAN_COLUMN_ID ?
isOrphanTask(...) : t.columnId === id`) steht heute inline in `app.tsx` und
`board-view.tsx`. `locateTask` nutzt dieselbe Regel. Eine Zusammenführung
der drei Stellen ist ein späterer Refactor, nicht Teil dieses Features.

## 6. Schritte

Ein Feature-Branch `feat/tui-search-jump`, ein Commit je Schritt, ein PR.
Kein Commit auf `main`.

Kanban-Tasks (Spalte Todo):

| Schritt | Kanban-ID |
|---|---|
| T1 | Qu8FhNJzD7eI |
| T2 | RQRdTLelESxf |
| T3 | c-0cb4BZbaq3 |
| T4 | cjAXi0FyWH_O |
| T5 | D8jcp_85hnOE |

### T1: Query-Parser und Suche als reine Funktionen

Komplexität: S. Blockiert von: nichts. Parallelisierbar mit: T2.

- `src/tui/search-query.ts` nach Abschnitt 5.
- `tests/search-query.test.ts`, Stil wie `tests/line-input.test.ts`:
  - `parseSearchQuery`: leer, nur Text, `faellig:2026-09 Kanban`,
    `Kanban faellig:2026-09-03`, `fällig:`-Schreibweise, zwei Datumstoken
    (letztes gilt), ungültiger Wert setzt `invalidDue`, Großschreibung
    wird normalisiert, mehrere Leerzeichen.
  - `buildSearchIndex`: Notizen werden nur für `hasNotes === true`
    geladen (Loader-Aufrufe zählen), `null`-Description stört nicht.
  - `matchesQuery`: Treffer in Titel, Beschreibung, Notizen, voller ID,
    Kurz-ID; `#42` im Titel; zwei Texttoken UND; Datum und Text UND;
    `dueDate: null` mit Datumsfilter trifft nie; `invalidDue` trifft nie;
    leere Query trifft alles.
  - `searchTasks`: Reihenfolge folgt `displayColumns`; Waise landet bei der
    Sammelspalte am Ende.
  - `locateTask`: Task in zweiter Spalte, dritte Zeile; Waise → Index der
    Sammelspalte; unbekannte ID → `null`.

Nachweis: `bun test tests/search-query.test.ts` grün.

### T2: `LineInputDisplay` und `calcScrollWindow` herauslösen

Komplexität: XS. Blockiert von: nichts. Parallelisierbar mit: T1.

- `line-input.tsx`: JSX-Rückgabe von `LineInput` in
  `export function LineInputDisplay({ state, mask }: { state: LineInputState; mask?: string })`.
  `LineInput` gibt `<LineInputDisplay state={state} mask={mask} />` zurück.
- `board-view.tsx`: `export` vor `calcScrollWindow`.
- Kein neuer Test nötig. Bestehende Tests decken das Verhalten ab.

Nachweis: `bun test` grün, `git diff --stat` zeigt nur diese zwei Dateien.

### T3: `SearchView` und Integration

Komplexität: M. Blockiert von: T1, T2.

- `src/tui/search-view.tsx` nach Abschnitt 5.
- `use-input-modes.ts`, `app.tsx`, `help-view.tsx`, `status-bar.tsx` nach
  Abschnitt 4.
- `tests/search-view.test.tsx` mit `renderToString` (Muster:
  `tests/board-picker.test.tsx`): leere Liste zeigt "Keine Treffer";
  Hinweis bei `invalidDue`; Spaltenname und Kurz-ID erscheinen; Cursor-Zeile;
  mehr Treffer als `maxVisible` zeigt Scroll-Indikator.

Nachweis: `bun test` grün. `wc -l src/tui/app.tsx` maximal 444.
Manuell in tmux: `f`, tippen, Pfeile, Enter, Cursor steht auf dem Task.

### T4: Mount-Regressionstests

Komplexität: S. Blockiert von: T3.

`tests/tui-search.test.ts`, Muster `tests/tui-input-drop.test.ts`
(FakeStdin/FakeStdout, `render()` mit injizierten Streams, ohne
`incrementalRendering`, damit der letzte volle Frame lesbar ist).

Fixture: `createTestBoard()`, drei Tasks über `addTaskInColumn()` in
`todo`, `in-progress`, `done`; einer mit Notiz über `ctx.notesService.save`;
einer mit `dueDate` über `ctx.taskService.updateTask`.

Tests:
1. `f` öffnet die Suche: letzter Frame enthält "Suche".
2. Tippen mit 5 ms Abstand: Treffer erscheint, Eingabezeile vollständig.
3. Treffer nur über Notiztext.
4. `faellig:2026-09` zeigt nur den Task mit Datum.
5. Enter: Header zeigt den Spaltennamen des Treffers (`board.displayColumns[selectedCol]?.name` steht im Header von `app.tsx`). Status zeigt `Sprung:`.
6. Esc: Header zeigt weiter "Todo", kein Statuswechsel.
7. Kein Treffer: "Keine Treffer" im Frame.

Nachweis: `bun test` grün.

### T5: `app.tsx` unter die 420-Zeilen-Grenze bringen

Komplexität: S. Blockiert von: T3 (sonst Merge-Konflikt). Eigener Branch,
eigener PR. Nicht Teil des Features, aber Pflicht laut CLAUDE.md
("Dateien über die harte Grenze wachsen lassen ohne Refactoring-Task").

Vorschlag: Die Handler der Detailansicht (`handleNoteSave` bis
`handleDescCancel`, rund 80 Zeilen) in einen Hook
`src/tui/use-detail-handlers.ts` verschieben. Reine Verschiebung, State
bleibt in `app.tsx`, wie beim Schnitt von `use-input-modes.ts`.

## 7. Abnahme

- `bun test` grün.
- `bun run src/index.ts tui` in tmux: `f`, "kanban" tippen, Liste
  filtert live, kein Flackern, Enter setzt den Cursor, `/`-Filter ist
  danach aufgehoben.
- `f` auf Board mit Waise: Waise erscheint mit "⚠ Ohne Spalte", Enter
  springt in die Sammelspalte.
- `?` zeigt den neuen Eintrag, Fußzeile zeigt `f=Suche`.

## 8. Entscheidungen von JoPa (2026-09-03)

Alle drei Punkte sind entschieden. Keine offenen Fragen mehr.

1. **Enter auf einem Treffer** setzt nur den Board-Cursor. Die Detailansicht
   öffnet sich nicht automatisch. Enter im Board bleibt der Weg dorthin.
2. **Aktiver `/`-Filter** wird beim Sprung aufgehoben (`setFilterText("")`),
   damit der Treffer sichtbar ist und eine Zeile hat.
3. **Leere Eingabe** zeigt alle Tasks in Board-Reihenfolge als Sprungliste.
