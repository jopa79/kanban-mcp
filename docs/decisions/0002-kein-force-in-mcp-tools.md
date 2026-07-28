# ADR 0002 — Kein `force` in MCP-Tools, Override nur im TUI

Datum: 2026-07-28
Status: Angenommen (Grilling-Session mit JoPa)
Betrifft: Zustandsmaschine, `kanban-mcp` 0.2.0

## Kontext

Mit 0.2.0 bekommt das Board eine Zustandsmaschine: die Spaltenkette ist
vorwaerts strikt (`zielIndex <= quellIndex + 1`), rueckwaerts frei;
neue Tasks entstehen nur in Backlog oder Todo; `done` setzt Review voraus;
WIP-Limits werden durchgesetzt.

Damit stellt sich die Frage, die sich bei jeder Regel stellt: gibt es einen
Weg daran vorbei?

Der uebliche Reflex ist ein `force`-Flag am Werkzeug. Das Muster existiert im
Repo bereits — `kanban_add_task_checked` hat es (`src/mcp/tools-extras.ts:21`),
und seine Ablehnung wirbt sogar aktiv dafuer: *"Verwende force=true zum
Erstellen."* (Zeile 33).

Genau das ist das Problem. Ein Agent, der eine Ablehnung liest, in der der
Umgehungsweg mitgeliefert wird, nimmt den Umgehungsweg. Nicht aus Boshaftigkeit,
sondern weil ein LLM darauf trainiert ist, die Aufgabe zu erledigen, und der
Text ihm sagt, wie. Eine Regel, deren Ablehnungstext ihre eigene Umgehung
dokumentiert, ist keine Regel.

## Entscheidung

**Harte Regeln haben in MCP-Tools keinen `force`-Parameter.** Kettenverstoss,
gesperrte Eintrittsspalte, `complete` ausserhalb Review und WIP-Ueberschreitung
werden abgelehnt, Punkt. Die Antwort traegt `isError: true` und beschreibt den
naechsten gueltigen Schritt.

**Override existiert ausschliesslich im TUI**, hinter einem
Bestaetigungsdialog, und wird im Transitions-Log mit `was_override = 1`
markiert.

**Eine Ausnahme: `kanban_add_task_checked` behaelt `force`.** Die
Duplikat-Erkennung ist eine Heuristik (Trigram-Similarity, `src/core/similarity.ts`)
und kann falsch liegen — zwei Tasks duerfen aehnlich heissen. Ein WIP-Zaehler
kann nicht falsch liegen; drei ist drei. Fuer eine fehlbare Regel ist ein
Umgehungsweg legitim, fuer eine exakte nicht.

Aber auch dort wird nicht mehr dafuer geworben: `force` verschwindet aus der
Tool-Beschreibung *und* aus dem Ablehnungstext. Der Parameter bleibt im Schema;
wer ihn braucht, kennt ihn. Die Ablehnung nennt stattdessen Titel und IDs der
aehnlichen Tasks, damit der Agent selbst entscheiden kann, ob einer davon sein
Anliegen bereits abdeckt.

## Begruendung

Die Asymmetrie zwischen MCP und TUI ist kein Zufall, sondern der Kern der
Entscheidung. Beide Kanaele unterscheiden sich in genau dem, worauf es
ankommt:

| | MCP | TUI |
|---|---|---|
| Aufrufer | Agent | Mensch |
| Kontext | Ausschnitt der Lage | ueberblickt das Board |
| Verantwortung | keine | traegt sie |
| Kosten eines Fehlgriffs | still, faellt spaeter auf | sofort sichtbar |
| Bestaetigung moeglich | nein | ja, Dialog |

JoPa kann eine Regel brechen, weil er weiss, warum er es tut, und weil er es
im selben Moment sieht. Ein Agent kann das nicht — er sieht den Ausschnitt,
den ihm sein Task gegeben hat, und er sieht die Konsequenz nie.

Der Zweck der Kette ist, dass Arbeit durch Review geht, bevor sie fertig
heisst. Ein `force`, das ein Agent selbst setzen kann, macht genau diesen
Zweck zunichte — dann ist die Kette Dekoration.

## Verworfene Alternativen

**`force` ueberall, aber im Transitions-Log markiert.**
Vollstaendige Nachvollziehbarkeit, keine Durchsetzung. Man haette eine saubere
Historie davon, wie die Regeln umgangen wurden. Der Zweck der Kette ist aber
Durchsetzung, nicht Protokollierung.

**`force` in MCP, aber nur fuer bestimmte Rollennamen (`teamlead`).**
Scheitert an der Technik: `reportedBy` ist self-reported. Claude Code teilt eine
MCP-Verbindung ueber alle Subagenten — der Server kann nicht feststellen, wer
tatsaechlich ruft. Eine Autorisierung, die auf einem frei waehlbaren String
beruht, ist keine.

**Regeln als Warnung statt Ablehnung (Move geht durch, Meldung im Log).**
Praktisch identisch mit "keine Regeln". Ein Agent liest die Antwort als Erfolg
und macht weiter.

**Ein zweites, verstecktes Tool `kanban_force_move`.**
Verlagert das Problem nur. Ein Tool, das im Tool-Katalog steht, wird gefunden
und benutzt.

**`force` ueber eine Umgebungsvariable am MCP-Server.**
Alles-oder-nichts pro Server, nicht pro Fall. Wer sie einmal setzt, hat sie
fuer immer gesetzt.

## Konsequenzen

- Ablehnungstexte werden zum Interface. Nicht `Fehler: WIP-Limit erreicht`,
  sondern: welche Spalte, wie voll, welcher Task blockiert seit wann, was der
  Aufrufer stattdessen tun kann. Wenn ein Agent aus dem Text nicht den naechsten
  Schritt ableiten kann, ist der Text ein Bug.
- Alle Ablehnungen brauchen `isError: true`. Eine Ablehnung ohne Fehlerflag wird
  als Erfolg gelesen — das ist heute in `tools-extras.ts:33` der Fall und wird
  mit 0.2.0 behoben.
- Agenten koennen sich festfahren: ein Task in In Progress bei vollem WIP-Limit
  laesst sich weder abschliessen noch weiterbewegen, ohne dass ein anderer Task
  vorher raus muss. Das ist beabsichtigt — genau dafuer sind WIP-Limits da. Der
  Ablehnungstext muss dann aber den Ausweg zeigen (welchen Task man bewegen
  koennte).
- Der Sync-Pfad ist ausgenommen: TodoWrite ist nicht ablehnbar, weil der Hook
  laeuft, nachdem der Agent den Zustand bereits gesetzt hat. Dort werden
  WIP-Verstoesse protokolliert (`was_override = 1`, `reason = "wip-exceeded (sync)"`)
  und in der TUI sichtbar gemacht, statt abgelehnt zu werden.
- Das TUI traegt damit Funktionalitaet, die es sonst nirgends gibt. Wer nur ueber
  MCP arbeitet, kann bestimmte Zustaende nicht herstellen. Das ist gewollt.
