# ADR 0003 — `.kanban/` ist reserviert fuer Board-Daten, globale Konfiguration liegt anderswo

Datum: 2026-07-29
Status: Angenommen
Betrifft: Multi-Board-Registry, `kanban-mcp` 0.2.0
Ausloeser: Umsetzung von P3-1

## Kontext

Die Multi-Board-Registry braucht einen Ort ausserhalb der Projekte. Die
urspruengliche Festlegung (Klaerungsfrage K-4) lautete `~/.kanban/registry.json` —
naheliegend, kurz, und scheinbar konsistent mit dem `.kanban/`-Ordner, den jedes
Board im Projektverzeichnis anlegt.

Beim Umsetzen stellte sich heraus: **`~/.kanban/` existierte bereits als echtes
Board.** Mit `board.db` (Schema v2), `config.json` und `"name": "joachimpaul"`,
angelegt Ende April durch ein versehentliches `kanban init` im
Home-Verzeichnis. Die Registry waere in ein bestehendes Board geschrieben worden.

Der Zufall hat einen Konstruktionsfehler sichtbar gemacht, der auch ohne ihn da
gewesen waere: `.kanban/` bedeutet im gesamten Werkzeug genau eine Sache, und
zwar an mehreren Stellen fest verdrahtet — `getBoardPaths()`, `boardExists()`,
`initBoard()` und (ab 0.2.0) die Aufwaertssuche `findBoardUpwards()` erkennen
alle ein Board daran, dass dieser Ordner da ist.

## Entscheidung

**`.kanban/` ist ein reservierter Marker: "hier liegt ein Board." Nichts anderes
wird dort abgelegt — weder im Projektverzeichnis noch im Home-Verzeichnis.**

Globale Konfiguration folgt der XDG Base Directory Spec:
`$XDG_CONFIG_HOME/kanban/`, ersatzweise `~/.config/kanban/`. Ein leerer
`XDG_CONFIG_HOME` gilt laut Spec als nicht gesetzt und faellt auf den Default
zurueck; ein **relativer** Wert ebenso — er wuerde die Registry sonst relativ
zum jeweiligen Arbeitsverzeichnis ablegen, also je nach Aufrufort in einer
anderen Datei.

Die Regel gilt ueber die Registry hinaus: kuenftige globale Artefakte — Cache,
Logs, Benutzereinstellungen — gehen ebenfalls nach `~/.config/kanban/` bzw. an
den passenden XDG-Ort, nie nach `~/.kanban/`.

## Begruendung

Ein Pfad, der zwei Dinge bedeuten kann, ist genau dort mehrdeutig, wo Klarheit
am meisten wert ist: beim Debuggen. Die Frage "liegt hier ein Board?" muss sich
durch Hinsehen beantworten lassen, nicht durch Hineinsehen.

Konkret waeren mit `~/.kanban/registry.json` folgende Fragen offen gewesen:

- Findet `findBoardUpwards()` aus einem Verzeichnis unter `~` heraus ein "Board"
  im Home-Verzeichnis, das keines ist?
- Was passiert bei `kanban init` im Home-Verzeichnis — ueberschreibt es die
  Registry, oder wird die Registry zum Board-Bestandteil?
- Was exportiert `kanban export` in einem Home-Board — die Registry mit?

Keine dieser Fragen muss beantwortet werden, wenn die Bedeutungen getrennt sind.
Das ist der Gewinn: nicht eine bessere Antwort, sondern keine Frage.

XDG ist die Konvention, die auf Linux erwartet wird, und auf macOS unschaedlich.
Sie kostet nichts und erspaart die Diskussion, ob ein weiterer Dotfile-Ordner im
Home-Verzeichnis noch vertretbar ist.

## Verworfene Alternativen

**`~/.kanban/registry.json` (die urspruengliche Festlegung).**
Kollidiert mit der Board-Bedeutung. Der konkrete Zusammenstoss bei JoPa war
Zufall; die Mehrdeutigkeit war es nicht.

**`~/.kanban/` behalten, aber Registry in `~/.kanban/_registry.json` mit
Unterstrich-Praefix.**
Loest die Dateikollision, nicht die Ordnerbedeutung. `boardExists()` wuerde den
Ordner weiterhin als Board erkennen.

**Registry im ersten gefundenen Board ablegen.**
Macht ein beliebiges Projekt zum Besitzer einer globalen Liste. Wird das Projekt
geloescht, ist die Registry weg.

**Keine Registry, stattdessen bei jedem `kanban boards` das Dateisystem
durchsuchen.**
Langsam und unvorhersehbar (welche Verzeichnisse? wie tief?). Eine explizite
Liste, die der Nutzer pflegt, ist ehrlicher als eine Heuristik, die manchmal
Boards findet.

## Konsequenzen

- `defaultRegistryDir()` lebt ausschliesslich in der CLI-Schicht
  (`src/cli/commands/init.ts`). `RegistryService` bekommt sein Verzeichnis immer
  explizit uebergeben und kennt den Default nicht — dadurch koennen Tests gegen
  ein Temp-Verzeichnis laufen, ohne die echte Registry zu beruehren.
- Das leere Home-Board wurde geloescht (null Tasks, null Dependencies, keine
  Notes). Ein `kanban init` im Home-Verzeichnis bleibt weiterhin moeglich — es
  ist nur nicht mehr der Ort, an dem etwas anderes ebenfalls liegt.
- Nutzer, die vor dieser Aenderung bereits eine `~/.kanban/registry.json`
  angelegt hatten, gibt es nicht: die Registry ist mit 0.2.0 neu.
- Die Regel gehoert in die README, damit sie nicht nur hier steht.
