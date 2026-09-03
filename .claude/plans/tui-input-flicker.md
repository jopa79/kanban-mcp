# Plan: TUI — Flackern und verschluckte Zeichen beim Tippen

Stand: 2026-09-03. Verfasst vom Teamlead, weil der Planer viermal an einem
API-Fehler (529 Overloaded) gescheitert ist. Befund gemessen und reproduziert.

## 1. Befund

### Bug A: Flackern

`src/tui/app.tsx` setzt am Wurzel-`Box` `height={termRows}`. Die Ausgabe füllt
damit exakt die Terminal-Höhe. Ink schaltet dann in seinen Vollbild-Pfad
(`node_modules/ink/build/ink.js:322`, Bedingung
`this.lastOutputHeight >= this.options.stdout.rows`). Dort schreibt Ink bei
jedem Frame `clearTerminal` (`ESC[2J ESC[3J ESC[H`) und danach den kompletten
Bildschirm neu, etwa 10 KB pro Frame. `ESC[3J` löscht zusätzlich den
Scrollback. Unter tmux 3.6a (JoPas Umgebung) ist das als Flackern sichtbar.

Jeder Tastendruck erzeugt zwei Frames: `ink-text-input` setzt nach jeder
Wertänderung in einem `useEffect` noch einmal seinen Cursor-State.

### Bug B: Verschluckte Zeichen und Tipp-Verzögerung

`inputValue` liegt im State von `App`. Jeder Tastendruck rendert das gesamte
Board neu (Header, alle Spalten, alle Karten, Footer). Gemessen: 9 ms im
Schnitt, 23 ms maximal pro Render.

Inks `useInput` (`node_modules/ink/build/hooks/use-input.js`) registriert den
Handler in einem `useEffect` mit `inputHandler` in den Deps. Bis dieser
Passive-Effect läuft, hängt noch der alte Handler mit dem alten `value`-Prop.
Kommt in dieser Lücke die nächste Taste, rechnet `ink-text-input`
`originalValue.slice(0, cursor) + input + ...` mit dem veralteten Wert und
überschreibt das vorherige Zeichen.

Messung (27 Zeichen, Board-Kopie, Fake-TTY 45×220):

| Tastenabstand | Frames | Angezeigt | Ergebnis |
|---|---|---|---|
| 60 ms | 54 | 27 | vollständig |
| 30 ms | 15 | 27 | vollständig |
| 15 ms | 10 | 24 | `allo Welt da ist in Test` |
| 8 ms | 7 | 24 | `allo Welt das ist en Tet` |
| 1 ms | 2 | 23 | `Ho Wlt as ist ein Testl` |

Watcher-Ereignisse während des Tippens: 0. Die Watcher-Schleife aus PR #48 ist
nicht die Ursache.

### Gleiches Muster

`src/tui/text-area.tsx` (Notizen-Editor) liest `lines`, `row`, `col` direkt aus
dem Closure im `useInput`-Handler. Dasselbe Stale-Closure-Risiko.

## 2. Ziel

1. Kein `ESC[2J` mehr im normalen Betrieb. Ink bleibt im Diff-Pfad.
2. Kein Zeichenverlust bis mindestens 5 ms Tastenabstand.
3. Ein Tastendruck rendert nur die Eingabezeile, nicht das Board.
4. Bestehende Tastenkürzel, Modi und Vorbelegungen bleiben unverändert.

## 3. Lösung

### Schritt 1: Vollbild-Pfad vermeiden (Bug A)

Datei: `src/tui/app.tsx`, `src/cli/commands/tui.ts`.

- Wurzel-`Box` auf `height={termRows - 1}` setzen. Die Ausgabe bleibt damit
  unter `stdout.rows`, Ink nutzt `log-update` mit Zeilen-Diff statt
  `clearTerminal`.
- `render(..., { incrementalRendering: true })` in `tui.ts` aktivieren. Ink
  6.8 schreibt dann nur geänderte Zeilen. Doku: `node_modules/ink/readme.md`,
  Abschnitt `incrementalRendering`.
- `BoardView` berechnet `maxVisible` aus `termRows - LAYOUT_OVERHEAD`. Prüfen,
  ob `LAYOUT_OVERHEAD` (8) die zusätzliche Zeile abdeckt. Wenn nicht, auf 9
  erhöhen. Sonst überläuft die Ausgabe und Ink fällt wieder in den
  Vollbild-Pfad.
- Der Resize-Handler in `board-view.tsx` schreibt `ESC[2J ESC[3J ESC[H` von
  Hand. Das bleibt, weil bei Resize ein voller Clear gewollt ist.

Nachweis: Test mit `render()` gegen Fake-Stdout (`isTTY: true`, `rows: 45`,
`columns: 220`), Fake-Stdin (`Readable` mit `setRawMode`-Stub), Option
`patchConsole: false`. Nach Mount, nach `n` und nach 10 getippten Zeichen darf
kein Write `ESC[2J` enthalten. Test mit einem hohen Board (mehr Tasks als
sichtbar) und mit `rows: 20`, damit der Überlauf-Fall geprüft wird.

Edge Cases:
- Resize während der Eingabe: `termRows` ändert sich, Box-Höhe folgt. Ein
  einmaliger Clear ist akzeptabel.
- Sehr kleines Terminal (`rows < LAYOUT_OVERHEAD + 2 * CARD_HEIGHT`):
  `maxVisible` bleibt mindestens 2, Ausgabe überläuft. Verhalten wie heute,
  kein neuer Fehler. Im Plan dokumentieren, nicht lösen.

### Schritt 2: Eigene einzeilige Eingabe-Komponente (Bug B)

Neue Datei: `src/tui/line-input.tsx`. Ersetzt `ink-text-input` in allen sechs
Aufrufern in `src/tui/status-bar.tsx` (AddInput, FilterInput, TitleInput,
DescInput, ExportInput, ImportInput). Keine neue Dependency. `ink-text-input`
erst entfernen, wenn kein Aufrufer mehr existiert (eigener Commit).

Schnittstelle:

```ts
interface LineInputProps {
  initialValue: string;        // Vorbelegung (Titel, Export-Pfad)
  onSubmit: (value: string) => void;
  onCancel?: () => void;       // Esc
}
```

Verhalten:
- Wert und Cursor als EIN `useState<{ value: string; cursor: number }>`.
  Jede Änderung über `setState(prev => ...)`. Der Handler liest nie den
  Wert aus dem Closure. Damit ist die Lücke zwischen Commit und
  Passive-Effect unschädlich.
- Der Wert liegt in der Komponente, nicht in `App`. Ein Tastendruck rendert
  nur die Eingabezeile. `App` bekommt den Wert erst bei `onSubmit`.
- Tasten: Zeichen einfügen an Cursor (auch Paste mit `input.length > 1`),
  Backspace/Delete, Pfeil links/rechts, Home/End (`key.home`, `key.end`),
  Enter → `onSubmit(value)`, Esc → `onCancel()`. Pfeil hoch/runter, Tab,
  Ctrl-Kombinationen ignorieren wie `ink-text-input`.
- Cursor-Darstellung wie bisher: inverses Zeichen, am Ende inverses Leerzeichen.
- `key.escape` in Export/Import-Pfad behandelt heute `use-input-modes.ts`.
  Diese Zeile dort entfernen, sobald `onCancel` in `LineInput` greift. Sonst
  reagieren zwei Handler auf Esc.

Änderungen in `app.tsx` und `use-input-modes.ts`:
- `inputValue` und `setInputValue` entfallen. Die Vorbelegung wandert als
  `initialValue`-Prop in die Aufrufer: `TitleInput` bekommt `detailTask.title`,
  `DescInput` bekommt `detailTask.description ?? ""`, `ExportInput` bekommt den
  Datums-Pfad, die übrigen `""`.
- `use-input-modes.ts`: `setInputValue`-Aufrufe entfernen, Prop aus
  `UseInputModesArgs` streichen. Der Export-Pfad mit Datum wird in `app.tsx`
  beim Rendern von `ExportInput` berechnet.
- Der Handler von `use-input-modes.ts` kehrt in Texteingabe-Modi früh zurück.
  Das bleibt.

Nachweis:
- Regressionstest wie in der Messung: 27 Zeichen mit 5 ms Abstand tippen, die
  Eingabezeile im letzten Frame muss alle 27 Zeichen zeigen.
- Unit-Tests für die reine Zustandsfunktion. Empfehlung: die Tastenlogik als
  exportierte reine Funktion `reduceLineInput(state, input, key)` auslagern.
  Dann sind Paste, Backspace am Anfang, Cursor am Ende, Home/End ohne
  Renderer testbar.
- `renderToString`-Test für die Darstellung (Muster: `tests/task-card.test.tsx`).

Edge Cases:
- Paste mit Zeilenumbruch: Zeilenumbrüche entfernen oder auf Leerzeichen
  abbilden. Entscheidung im Plan: entfernen, einzeilige Eingabe.
- Backspace-Wiederholung (Taste gehalten): funktionale Updates decken das ab.
  Im Regressionstest mit 5 ms Abstand prüfen.
- Board-Wechsel während Eingabe: `mode` springt auf `board`, die Komponente
  wird unmountet, kein Zustand bleibt zurück.
- Filter-Modus: heute übernimmt `handleFilterSubmit` den Wert erst bei Enter.
  Das bleibt so. Live-Filter ist kein Ziel dieses Plans.

### Schritt 3: `text-area.tsx` auf funktionale Updates umstellen

Datei: `src/tui/text-area.tsx`.

- `lines`, `row`, `col` in EIN `useState<{ lines: string[]; row: number;
  col: number }>` zusammenführen. Jede Änderung über `setState(prev => ...)`.
- `state` (`editing` / `confirm-exit`) kann getrennt bleiben, weil ein
  Moduswechsel nicht mit Tippen kollidiert.
- `onSave(lines.join("\n"))` im Bestätigungsdialog liest aus dem Closure. Dort
  ist das unkritisch, weil zwischen Esc und Enter kein Tippen stattfindet.
  Trotzdem über `setState(prev => { onSave(...); return prev; })` oder einen
  `useRef`-Spiegel absichern, damit kein zweites Muster entsteht.
- Empfehlung: Tastenlogik als reine Funktion `reduceTextArea(state, input,
  key)` auslagern, analog zu Schritt 2. Bestehende Tests: keine. Neue
  Unit-Tests für Enter mitten in der Zeile, Backspace am Zeilenanfang, Pfeil
  hoch mit kürzerer Zielzeile, Tab.

Nachweis: Regressionstest wie Schritt 2 im Modus `edit-notes`, 27 Zeichen mit
5 ms Abstand.

### Schritt 4: `ink-text-input` entfernen

Nur wenn Schritt 2 gemergt ist und `grep -r "ink-text-input" src/` leer ist.
`bun remove ink-text-input`. Eigener Commit. Rückfrage bei JoPa vor dem
Entfernen ist nicht nötig, weil keine neue Dependency dazukommt. Trotzdem im
PR-Text nennen.

## 4. Reihenfolge und Abhängigkeiten

| Nr. | Task | Hängt ab von | Branch |
|---|---|---|---|
| 1 | Vollbild-Pfad vermeiden + Regressionstest Clear | – | `fix/tui-flicker` |
| 2 | `LineInput` + Umbau der sechs Aufrufer + Regressionstest Zeichenverlust | – | `fix/tui-input-drop` |
| 3 | `text-area.tsx` funktionale Updates + Tests | 2 (gleiches Reducer-Muster) | `fix/tui-textarea-stale` |
| 4 | `ink-text-input` entfernen | 2 | in Branch von 2, letzter Commit |

Task 1 und 2 sind unabhängig und können parallel laufen. Beide berühren
`app.tsx`. Konflikte sind klein: Task 1 ändert eine Zeile am Wurzel-Box, Task 2
die Footer-Zeilen und den State-Block.

Grenze: `app.tsx` hat eine Stoppgrenze von 420 Zeilen (Kommentar in
`use-input-modes.ts`). Task 2 entfernt Zeilen, überschreitet sie nicht.

## 5. Abnahme

- `bun test` grün.
- `bun run src/index.ts tui` in tmux: kein Flackern beim Tippen, kein
  Zeichenverlust bei gehaltener Taste, Scrollback bleibt erhalten.
- Manuell prüfen: `n` tippen, Text eingeben, Enter. `/` Filter. `E` Export mit
  vorbelegtem Pfad. Detail → `T` Titel mit Vorbelegung. Detail → `e` Notizen.
- Regressionstests zeigen `ESC[2J`-Anzahl 0 und 27/27 Zeichen bei 5 ms.

## 6. Offene Fragen an JoPa

- Keine. `ink-text-input` entfällt, das ist eine Reduktion, keine neue
  Abhängigkeit.
