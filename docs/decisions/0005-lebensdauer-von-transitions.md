# ADR 0005 — Transitions wachsen unbegrenzt, sichtbar statt gekappt

Datum: 2026-08-13
Status: Angenommen
Betrifft: `transitions`-Tabelle, `kanban status`, `kanban-mcp` 0.2.0
Ausloeser: Klaerungsfrage K-5 — was passiert mit `transitions`-Zeilen von Tasks, die nie archiviert werden?

## Kontext

Jeder Zustandswechsel eines Tasks schreibt eine Zeile nach `transitions`. Geloescht wird
sie an genau einer Stelle: `ON DELETE CASCADE`, wenn der Task selbst verschwindet.

Das trifft heute kaum zu:

- `deleteTask` ist der seltene Fall.
- `archiveTasks` setzt nur ein Flag. Der Task bleibt, seine Transitions bleiben.
- `purgeArchive` loescht Tasks hart — dort greift die Cascade, dort ist alles gut.

**Der eigentliche Treiber ist der Reconcile-Sync.** Ein Todo, das erstmals als `completed`
auftaucht, erzeugt vier Zeilen in derselben Sekunde: Entstehung, `todo` → `in-progress`,
→ `review`, → `done`. Bei taeglicher Agenten-Arbeit summiert sich das.

Eine Zeile ist rund 120 Byte. 10.000 Transitions sind etwa 1,2 MB.

## Entscheidung

**Fuer 0.2.0 wird nichts gekappt. Stattdessen wird die Zahl sichtbar gemacht:
`kanban status` weist die Transitions-Zeilenzahl aus.**

Fuer 0.3.0 vorgemerkt (eigener Task, nicht Teil dieser Entscheidung):

- ein explizites `kanban purge-transitions --older-than <tage>`, analog zu `purge-archive`
- Reconcile-Transitions (`reason = "reconcile"`) gesondert behandeln — sie sind die
  einzigen, die in Masse entstehen, und liessen sich kappen, ohne die von Hand
  entstandene Historie zu verlieren

## Begruendung

Die Groessenordnung rechtfertigt heute keinen Mechanismus. 1,2 MB bei 10.000 Zeilen ist
fuer eine lokale SQLite-Datei kein Problem, und kein Nutzer hat bisher genug Transitions,
dass es auffiele.

Was fehlte, war nicht eine Obergrenze, sondern **Wahrnehmung**: Ohne Anzeige merkt niemand,
dass die Tabelle waechst, bis die Datei spuerbar gross ist. Eine Zahl in `kanban status`
kostet eine `COUNT(*)`-Abfrage und macht die Entscheidung ueberpruefbar — wer in einem
halben Jahr 200.000 Zeilen sieht, weiss, dass 0.3.0 dran ist.

Die Zahl wird **immer** angezeigt, auch bei 0 — anders als die Waisen-Zeile, die nur bei
Bedarf erscheint. Null Waisen sind ein Nicht-Ereignis; null Transitions sind eine Aussage
ueber ein frisches Board. Grosse Zahlen werden gruppiert (`12.483`), damit die
Groessenordnung ins Auge faellt und nicht die Ziffernfolge gelesen werden muss.

## Verworfene Alternativen

**Kappung pro Task** (z.B. die letzten 50 behalten). Braucht Aufraeum-Logik bei jedem
Insert und verliert genau die Historie, die man bei einem lange laufenden Task sehen
will — dort ist der Verlauf am interessantesten.

**Sofort `purge-transitions` bauen.** Ein Kommando gegen ein Problem, das niemand hat.
Es waere ungenutzt und muesste trotzdem gepflegt und getestet werden. Wenn es kommt,
soll es an gemessenem Bedarf ausgerichtet sein, nicht an einer Vermutung.

**Automatisches Aufraeumen im Hintergrund.** Loeschen ohne Ansage widerspricht dem Rest
des Werkzeugs: `purge-archive` ist explizit und verlangt eine Bestaetigung. Historie
still verschwinden zu lassen waere die unangenehmste Variante — man merkt es erst, wenn
man sie braucht.

## Konsequenzen

- `TransitionService.count()` und `getStatus().transitionCount` sind neu. Das Feld
  erscheint additiv auch in `kanban status --json` und im MCP-Tool `kanban_status`.
- Die Tabelle waechst weiterhin unbegrenzt. Das ist bewusst und wird ueberwacht, nicht
  ignoriert.
- Wenn die Zahl bei jemandem entgleist, ist das ein Datenpunkt fuer 0.3.0 — kein Bug.
