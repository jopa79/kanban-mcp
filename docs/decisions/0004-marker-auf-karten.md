# ADR 0004 — Karten-Marker sind ASCII fester Breite, Symbole beginnen ausserhalb der Karte

Datum: 2026-08-13
Status: Angenommen
Betrifft: TUI-/CLI-Statusmarker, `kanban-mcp` 0.2.0
Ausloeser: Beobachtete Inkonsistenz beim Ueberfaellig-Marker zwischen TUI-Karte (`[!]`) und CLI/TUI-Waisenspalte (`⚠`)

## Kontext

Derselbe Zustand — ein ueberfaelliger Task (`task.isOverdue`) — wird an vier Stellen angezeigt:

- TUI-Karte (`task-card.tsx:48`): `[!]`, direkt neben `[B]` (blockiert, Zeile 49) und `[N]` (Notizen, Zeile 50).
- CLI, Zeilenausgabe (`formatters.ts:53`, `formatDueDateMarker`): `⚠ faellig <Datum>`.
- CLI, Detailausgabe (`formatters.ts:92`, `formatTaskDetail`): `⚠ ueberfaellig`.
- TUI-Waisenspalte (`use-board.ts:45`, `buildOrphanColumn`): Spaltenname `"⚠ Ohne Spalte"`, identisch im CLI-Pendant `formatters.ts:132`.
- TUI-Detailansicht (`detail-view.tsx:34`): bislang keines von beidem — nur der ausgeschriebene Klartext-Suffix `(ueberfaellig)`, ohne Symbol.

Auf den ersten Blick sieht das nach einer vergessenen Anpassung aus: drei Stellen `⚠`, eine `[!]`, eine ganz ohne Symbol. Es ist keine. Die Karte weicht bewusst ab — aus zwei Gruenden, die sich aus dem bestehenden Code ableiten lassen (siehe Begruendung), die aber nie an einem Ort standen, der sie als Regel statt als Einzelfall lesbar macht.

## Entscheidung

**Auf der Karte stehen ASCII-Marker fester Breite. Ausserhalb der Karte — CLI, Detailansicht, Waisenspalte — steht das aussagekraeftigere Symbol `⚠`.**

- Karte: `[!]` (ueberfaellig), `[B]` (blockiert), `[N]` (Notizen) — unveraendert.
- CLI und Waisenspalte: `⚠` — unveraendert.
- Detailansicht: wird angeglichen. `(ueberfaellig)` wird zu `⚠ ueberfaellig`, wortgleich mit `formatTaskDetail` in der CLI.

## Begruendung

Zwei technische Gruende, beide im bestehenden Code beobachtbar:

1. **Musterbruch.** Die Karte zeigt bis zu drei Marker nebeneinander: `[!]`, `[B]`, `[N]`. Ein Warnzeichen zwischen zwei Klammer-Markern bricht das Klammer-Muster genau an der Stelle, wo drei Marker gleichzeitig sichtbar sein koennen.
2. **Zellenbreite.** `⚠` ist im Terminal, abhaengig von Font und Emulator, ein oder zwei Zellen breit; `!` ist immer genau eine. Die Kartenbreite ist prozentual von der Terminalbreite abgeleitet (`board-view.tsx:82`, `100 / columns.length`) — schmal und variabel, keine feste Groesse. Ein Zeichen mit unvorhersehbarer Breite macht das Layout einer ohnehin schmalen Karte unvorhersehbar. Ausserhalb der Karte — CLI-Zeile, Detailansicht, Spaltenname — gibt es keine vergleichbare Breitenbeschraenkung; der Spielraum fuer das aussagekraeftigere Symbol ist da.

Die Karte optimiert auf Dichte und vorhersehbares Layout. Alles ausserhalb optimiert auf Lesbarkeit. Das ist kein Widerspruch, sondern derselbe Marker in zwei Kontexten mit unterschiedlichen Anforderungen.

## Verworfene Alternativen

**`⚠` ueberall, auch auf der Karte.**
Loest die Inkonsistenz, aber auf Kosten des Kartenlayouts (Begruendung, Punkt 2) und bricht das `[B]`/`[N]`-Klammermuster (Punkt 1).

**`[!]` ueberall, auch in CLI und Waisenspalte.**
CLI und Waisenspalte haben keine Breitenbeschraenkung, die ein ASCII-Zeichen erzwingt. `[!]` waere dort reiner Verzicht auf Ausdruckskraft ohne Gegenwert.

**Eigenes drittes Symbol nur fuer die Detailansicht.**
Haette fuer denselben Zustand eine dritte Marker-Sprache eingefuehrt, statt die Detailansicht an das in CLI und Waisenspalte bereits etablierte Aussen-Symbol anzugleichen.

## Konsequenzen

- `task-card.tsx`, `formatters.ts` und `use-board.ts` sind bereits konform mit dieser Regel — keine Aenderung.
- `detail-view.tsx:34` aendert den Suffix von `(ueberfaellig)` zu `⚠ ueberfaellig`.
- Kuenftige neue Statusmarker richten sich nach derselben Regel, statt Karte vs. Aussenwelt jedes Mal neu zu entscheiden: Kartenkontext → ASCII fester Breite, jeder andere Anzeigekontext → `⚠` bzw. ein vergleichbar aussagekraeftiges Symbol.
