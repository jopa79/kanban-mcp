# Plan: TUI — Sprung-Suchmodus (Taste `g`)

GitHub: #51. Stand: 2026-09-03. Verfasst vom Planer. Grundlage: Brainstorming mit JoPa
(abgeschlossen, nicht neu verhandeln) und Code-Analyse von `src/tui/`.

## 1. Ziel

Taste `g` im Board-Modus öffnet einen Suchmodus. JoPa tippt einen Suchtext.
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
`LineInputDisplay({ state })` herausgelöst. `LineInput` nutzt sie
weiter, die Schnittstelle von `LineInput` bleibt gleich. Der Prop `mask`
ist toter Code (kein Aufrufer setzt ihn) und entfällt dabei.

WARNUNG (Blocker B aus dem Review): `useRef(f())` ruft `f()` bei JEDEM
Render auf, React verwirft nur das Ergebnis. `line-input.tsx:97` nutzt
dieses Muster für ein billiges Objektliteral. Für den Suchindex mit
Dateizugriffen ist es verboten. Siehe Abschnitt 5, Lazy-Init.

Bekannte Einschränkung: `reduceLineInput()` rechnet in UTF-16-Code-Units.
Emoji im Suchtext erzeugen bei Backspace ein Lone Surrogate und der
Cursor verschwindet. Das ist ein bestehender Fehler aus #50, kein neuer.
Der devils-advocate hat ihn dem Teamlead als Folgetask zu #50 gemeldet.
Empfehlung: den Code-Point-Fix VOR T3 einplanen, weil im Suchmodus nach
Titeln mit Emoji gesucht wird.

### 2.3 Vollbild statt Footer

`BoardPicker` (`src/tui/board-picker.tsx`) ersetzt das Board komplett
(`if (mode === "board-picker") return <BoardPicker/>`). Der Suchmodus macht
das genauso. Grund: Die Trefferliste braucht Höhe. Ein Footer-Overlay unter
dem Board würde bei jeder Taste das Board mit rendern.

Zwei Punkte, in denen `BoardPicker` KEIN Vorbild ist:

1. **Höhe (Blocker A aus dem Review).** Nur der Board-Zweig in `app.tsx`
   begrenzt die Höhe (`height={termRows - 1}`, `overflow="hidden"`). Der
   BoardPicker-Zweig tut das nicht. Erreicht die Suchansicht die
   Terminalhöhe, fällt Ink in den Vollbild-Pfad und schreibt bei jedem
   Tastendruck `ESC[2J ESC[3J`. Gemessen: Gesamthöhe >= rows ergibt 4
   Clears bei 6 Tasten, Gesamthöhe <= rows - 1 ergibt 0 Clears. Deshalb
   bekommt der Wurzel-Box der `SearchView` `height={rows - 1}` und
   `overflow="hidden"`. Die Overhead-Konstante für `maxVisible` ist damit
   Kosmetik, kein Korrektheitsrisiko. T4 prüft das mit `rows: 24`.
2. **Frühausstieg in `use-input-modes.ts`.** `"board-picker"` und
   `"archive"` fehlen dort heute. `useInputModes` läuft in `app.tsx` VOR
   den frühen Returns, deshalb reagieren dort zwei Handler (`q` im Archiv
   beendet die TUI, Esc hinterlässt "Filter aufgehoben"). Das ist ein
   bestehender Bug, siehe GitHub Issue und Kanban-Task T6. `"search"`
   MUSS im Frühausstieg stehen.

### 2.4 Cursor-Position des Treffers

`app.tsx` berechnet die Zeile aus `filteredTasks` (Titel-Filter aus `/`).
Ein Treffer, den der Filter verbirgt, hat dort keine Zeile.

Entscheidung: Der Sprung hebt den Filter auf (`setFilterText("")`). Die
Zeile ist der Index des Tasks in der SPALTEN-gefilterten Liste, also in
`board.tasks.filter(gehört zur Zielspalte)`, nicht der Index in
`board.tasks` selbst. So rechnet `app.tsx` heute `currentColTasks`.
`board.tasks` ist bereits in der Reihenfolge sortiert, die das Board zeigt
(`effectiveSort` läuft durch `useBoard`). Die Spalte kommt aus
`board.displayColumns`, für Waisen über `isOrphanTask()` auf den Index der
Sammelspalte.

`handleSearchSelect` in `app.tsx` ruft `locateTask()` mit dem AKTUELLEN
`board.tasks` auf, nicht mit der Liste, die `SearchView` beim Mount bekam.
Ändert der Watcher das Board während der Suche, stimmt die Zeile trotzdem.
Der Clamp-Effekt für `selectedRow` in `app.tsx` stört nicht, weil
`setFilterText("")` und `setSelectedRow(row)` im selben React-Batch laufen.

Im Verschiebe-Modus ist `g` unerreichbar. Der Block `if (moving &&
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
- Leere Eingabe: alle Tasks in Board-Reihenfolge. So dient `g` auch als
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

Reihenfolge im `useInput`-Handler ist verbindlich:

1. Pfeil hoch/runter: Listen-Cursor bewegen, dann `return`. Diese Tasten
   werden VOR `reduceLineInput()` abgefangen, weil der Reducer sie mit
   `action: "none"` durchreicht.
2. Alles andere durch `reduceLineInput()`. `action: "submit"` ruft
   `onSelect(hits[cursor])`, aber nur wenn `hits[cursor] !== undefined`.
   `action: "cancel"` ruft `onCancel()`.
3. Nur wenn `next.value !== prev.value`: Listen-Cursor auf 0. Pfeil
   links/rechts und Home/End ändern den Wert nicht und lassen den
   Listen-Cursor stehen.

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
| `src/tui/line-input.tsx` | `LineInputDisplay` herauslösen und exportieren. Toten Prop `mask` entfernen. Verhalten unverändert. |
| `src/tui/board-view.tsx` | `calcScrollWindow` exportieren. Sonst unverändert. |
| `src/tui/use-input-modes.ts` | `Mode` um `"search"` erweitern. Im Board-Block: `if (input === "g") { setMode("search"); }`. Im Frühausstieg der Texteingabe-Modi `"search"` ergänzen, sonst reagieren zwei Handler. |
| `src/tui/app.tsx` | Import, `if (mode === "search") return <SearchView .../>` neben dem BoardPicker-Zweig, `handleSearchSelect`, `handleSearchCancel`. Maximal +12 Zeilen. |
| `src/tui/help-view.tsx` | Eintrag `{ key: "g", desc: "Task suchen und hinspringen (goto)" }` nach `/`. |
| `src/tui/status-bar.tsx` | `f=Suche` in der Fußzeile nach `/=Filter`. Die Zeile hat rund 122 Zeichen und bricht bei 80 Spalten schon heute um. Im selben Zug kürzen, z.B. `a=Arch.  A=Archiv` zu `a/A=Archiv` und `E=Export  I=Import` zu `E/I=Export/Import`, damit die Zeile mit `f=Suche` nicht länger wird als heute. |
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
// Nur fuer hasNotes === true aufgerufen. Liefert der Loader null (Datei
// manuell geloescht), zaehlt die Notiz als leer. Notizen werden auf
// NOTES_INDEX_LIMIT = 4096 Zeichen gekappt, damit ein Board mit langen
// Notizen den Index nicht in den Megabyte-Bereich treibt.
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

- Suchindex EINMAL beim Mount, per Lazy-Init (Blocker B aus dem Review):

  ```ts
  const indexRef = useRef<SearchEntry[] | null>(null);
  if (indexRef.current === null) {
    const notes = new NotesService(kanbanDir);   // einmal, nicht pro Task
    indexRef.current = buildSearchIndex(tasks, (id) => notes.load(id));
  }
  ```

  NICHT `useRef(buildSearchIndex(...))`. Das ruft den Index-Aufbau samt
  Dateizugriffen bei jedem Render auf (gemessen: 7 Aufrufe nach 6 Tasten).
  `tasks` ändert sich während der Suche nur durch den Watcher. Das ist
  akzeptabel: die Liste zeigt den Stand beim Öffnen, `locateTask` beim
  Sprung prüft gegen den aktuellen Stand.
- `inputRef` + `useState` für `LineInputState`, das Muster aus `LineInput`
  (Ref ist die Quelle der Wahrheit, State löst nur Rendern aus). Der
  Anfangswert ist ein Objektliteral, dort ist `useRef(init(...))` harmlos.
- `hits = useMemo(() => searchTasks(index, parseSearchQuery(input.value), ...), [input.value, ...])`.
- Wurzel-Box: `<Box flexDirection="column" height={rows - 1} overflow="hidden">`
  mit `rows` aus `useStdout()` (Blocker A, Abschnitt 2.3). `maxVisible` =
  `rows - SEARCH_LAYOUT_OVERHEAD`, Konstante 6 (Rahmen 2, Titel 1,
  Eingabezeile 1, Fußzeile 1, Reserve 1). Ein Fehler in der Konstante
  kostet eine Zeile Anzeige, nie ein Flackern.

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
    geladen (Loader-Aufrufe zählen), `null`-Description stört nicht,
    `hasNotes === true` mit Loader-Ergebnis `null` (Datei fehlt) stört
    nicht, Notiz länger als `NOTES_INDEX_LIMIT` wird gekappt.
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
  `export function LineInputDisplay({ state }: { state: LineInputState })`.
  `LineInput` gibt `<LineInputDisplay state={state} />` zurück. Den Prop
  `mask` aus `LineInputProps` und der Darstellung entfernen (kein Aufrufer
  in `src/` oder `tests/`).
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
Manuell in tmux: `g`, tippen, Pfeile, Enter, Cursor steht auf dem Task.

### T4: Mount-Regressionstests

Komplexität: S. Blockiert von: T3.

`tests/tui-search.test.ts`, Muster `tests/tui-input-drop.test.ts`
(FakeStdin/FakeStdout, `render()` mit injizierten Streams, ohne
`incrementalRendering`, damit der letzte volle Frame lesbar ist).

Fixture: `createTestBoard()`, drei Tasks über `addTaskInColumn()` in
`todo`, `in-progress`, `done`; einer mit Notiz über `ctx.notesService.save`;
einer mit `dueDate` über `ctx.taskService.updateTask`.

Tests:
1. `g` öffnet die Suche: letzter Frame enthält "Suche".
2. Tippen mit 5 ms Abstand: Treffer erscheint, Eingabezeile vollständig.
3. Treffer nur über Notiztext.
4. `faellig:2026-09` zeigt nur den Task mit Datum.
5. Enter: Header zeigt den Spaltennamen des Treffers (`board.displayColumns[selectedCol]?.name` steht im Header von `app.tsx`). Status zeigt `Sprung:`.
6. Esc: Header zeigt weiter "Todo", kein Statuswechsel.
7. Kein Treffer: "Keine Treffer" im Frame.
8. Flacker-Schutz (Blocker A): FakeStdout mit `rows: 24`, Suche öffnen,
   sechs Zeichen tippen, `incrementalRendering: true`. Kein geschriebener
   Chunk enthält `ESC[2J` (Muster: `tests/tui-render.test.ts`). Board mit
   mehr Tasks als `maxVisible`, damit die Liste voll ist.

Nachweis: `bun test` grün.

### T5: `app.tsx` unter die 420-Zeilen-Grenze bringen

Komplexität: S. Blockiert von: T3 (sonst Merge-Konflikt). Eigener Branch,
eigener PR. Nicht Teil des Features, aber Pflicht laut CLAUDE.md
("Dateien über die harte Grenze wachsen lassen ohne Refactoring-Task").

Vorschlag: Die Handler der Detailansicht (`handleNoteSave` bis
`handleDescCancel`, rund 80 Zeilen) in einen Hook
`src/tui/use-detail-handlers.ts` verschieben. Reine Verschiebung, State
bleibt in `app.tsx`, wie beim Schnitt von `use-input-modes.ts`.

### T6: Doppel-Handler in Archiv und Board-Picker (bestehender Bug)

Komplexität: XS. Blockiert von: nichts. Eigener Branch, eigener PR. Nicht
Teil des Features. Gefunden im Review dieses Plans.

`"archive"` und `"board-picker"` fehlen im Frühausstieg von
`use-input-modes.ts`. Folge: `q` im Archiv beendet die TUI statt zum Board
zurückzugehen, Esc hinterlässt "Filter aufgehoben", Pfeiltasten verschieben
zusätzlich den Board-Cursor. Fix: beide Modi in die Liste aufnehmen.
Mount-Test: `A`, dann `q`, TUI läuft weiter und zeigt das Board.

## 7. Abnahme

- `bun test` grün.
- `bun run src/index.ts tui` in tmux: `g`, "kanban" tippen, Liste
  filtert live, kein Flackern, Enter setzt den Cursor, `/`-Filter ist
  danach aufgehoben.
- `g` auf Board mit Waise: Waise erscheint mit "⚠ Ohne Spalte", Enter
  springt in die Sammelspalte.
- `?` zeigt den neuen Eintrag, Fußzeile zeigt `f=Suche`.

## 8. Entscheidungen von JoPa (2026-09-03)

Alle drei Punkte sind entschieden. Keine offenen Fragen mehr.

1. **Enter auf einem Treffer** setzt nur den Board-Cursor. Die Detailansicht
   öffnet sich nicht automatisch. Enter im Board bleibt der Weg dorthin.
2. **Aktiver `/`-Filter** wird beim Sprung aufgehoben (`setFilterText("")`),
   damit der Treffer sichtbar ist und eine Zeile hat.
3. **Leere Eingabe** zeigt alle Tasks in Board-Reihenfolge als Sprungliste.

## 9. Review-Historie

- 2026-09-03, devils-advocate: NEEDS WORK. Blocker A (Vollbild-Höhe ohne
  Begrenzung bringt `ESC[2J` zurück) und Blocker B (`useRef(f())` baut den
  Index pro Render). Beide gemessen. Eingearbeitet in Abschnitte 2.2, 2.3,
  2.4, 3, 4, 5, T1, T2, T4 und neuer T6.

## Nachtrag (2026-09-03): Taste geändert von "f" auf "g"

Ursprünglich war "f" für diesen Suchmodus vorgesehen. JoPa hat entschieden,
dass der bestehende Titel-Filter (bisher Taste "/") auf "f" umgestellt wird
(GitHub #52, separates kleines Issue, unabhängig von diesem Plan). Um die
Tastenkollision zu vermeiden, verwendet der Sprung-Suchmodus aus diesem Plan
jetzt "g" (goto) statt "f". Alle Stellen in diesem Dokument sind bereits
darauf aktualisiert.
