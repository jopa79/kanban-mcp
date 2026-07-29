# Changelog

Alle wesentlichen Aenderungen an diesem Projekt werden hier dokumentiert.

Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.0.0/),
Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Added

- Schema v3: Spalten-Konfiguration in `.kanban/config.json` statt in einer
  DB-Tabelle — lesbar, editierbar und versionierbar (ADR 0001, `docs/decisions/0001-spalten-in-config-statt-datenbank.md`)
  - Jede Spalte bekommt `allowEntry` (darf `kanban_add_task` dort neue Tasks
    anlegen?) statt einer separaten Eintrittsspalten-Liste im Code
  - Kein `position`-Feld mehr — die Array-Reihenfolge in `config.json` ist die
    Reihenfolge; eine Spalte verschieben heisst eine Zeile verschieben
  - `validateBoardConfig()` / `loadBoardConfig()` validieren config.json beim
    Laden mit verstaendlichen Fehlermeldungen (Pfad + Grund, kein Stacktrace):
    fehlende/leere Spaltenliste, keine oder mehrere Terminal-Spalten, keine
    Eintrittsspalte, doppelte Spalten-IDs, faelschlich vorhandenes `position`-Feld
  - `BoardService.getOrphanColumnIds()` — findet Tasks, deren Spalte in
    `config.json` fehlt (Grundlage fuer die Waisen-Behandlung in einem
    Folge-Task; wird aktuell nur ermittelt, noch nicht in TUI/CLI angezeigt)
- Schema v3: `transitions`-Tabelle (Zustandshistorie eines Tasks, wird ab
  Paket 1 befuellt) sowie `priority`/`due_date`-Spalten auf `tasks` (echte,
  sortierbare Felder; Durchreichen an CLI/MCP/TUI folgt in Paket 2)
  - `Transition`/`TransitionRow`-Typen und `rowToTransition()` in `types.ts`,
    analog zu `Task`/`TaskRow`/`rowToTask`
  - Bewusst **kein** `source_id` und kein `updated_by` auf `tasks` — siehe
    Plan Abschnitt 0.1 (TodoWrite liefert kein `id`-Feld) und Entscheidung K-3
  - `tasks`-Spalten-DDL und Index-/Transitions-Erzeugung sind jetzt geteilte
    Bausteine (`TASKS_TABLE_COLUMNS_DDL`, `createTaskIndexes()`,
    `createTransitionsTable()` in `db.ts`) — verhindert Schema-Drift zwischen
    neu angelegten und migrierten Boards
- `kanban migrate [--dry-run] [--yes]` — explizites Kommando fuer die
  Schema-Migration v2 auf v3 (ADR 0001, `src/core/migrate-v3.ts`)
  - Backup vor jeder Migration per `VACUUM INTO` nach `board.db.bak-v2`
    (WAL-sicher — eine reine Datei-Kopie waere bei offenen Transaktionen
    unvollstaendig); ein bestehendes Backup wird nie ueberschrieben, sondern
    als `board.db.bak-v2.<timestamp>` ergaenzt
  - Spalten werden aus der `columns`-Tabelle nach `config.json` uebersetzt:
    nach `position` sortiert, Array-Reihenfolge ersetzt das Feld (auch bei
    lueckenhaften Werten); die ersten beiden Spalten werden Eintrittsspalten
  - `config.json` wird atomar geschrieben (tmp-Datei + fsync + rename) und vor
    dem DB-Umbau zurueckgelesen und verifiziert — bei Abweichung bricht die
    Migration ab, ohne die DB anzufassen
  - `tasks` wird ohne `columns`-Fremdschluessel neu aufgebaut
    (`PRAGMA foreign_keys = OFF` waehrend des Tabellen-Neubaus, sonst
    kaskadiert `DROP TABLE tasks` die komplette `dependencies`-Tabelle weg);
    Nachpruefung per Zeilenzahl-Vergleich und `PRAGMA foreign_key_check`
  - Wiederaufsetzbar: bricht ein Lauf nach dem Schreiben von `config.json` ab,
    erkennt der naechste Lauf das und ueberspringt den Schreibschritt
  - Verifiziert gegen eine Kopie des echten Projekt-Boards (44 Tasks,
    49 Dependencies, 1 archivierter Task) — alle Zahlen nach der Migration
    identisch, `PRAGMA foreign_key_check` liefert nichts
- Board-Registry (`~/.config/kanban/registry.json`, respektiert
  `XDG_CONFIG_HOME`; pfadbasierter Kern von P3-1) — Grundlage fuer das
  kommende `kanban boards`-Kommando
  - `src/core/registry-service.ts`: registrieren (idempotent), entfernen,
    lesen; tote Pfade werden als `missing` markiert statt entfernt
  - Registry-Verzeichnis ist injizierbar (Konstruktor-Parameter), niemals im
    Service hartkodiert
  - Bewusst **nicht** unter `~/.kanban/` — das heisst im Code bereits
    eindeutig "hier liegt ein Board" (siehe `getBoardPaths()` in `db.ts`)
  - Atomares Schreiben (tmp-Datei + rename) gegen gleichzeitige Prozesse
  - `kanban init` registriert automatisch, `--no-register` schaltet das ab
  - **Bewusst getrennt**: `initBoard()` selbst registriert nie — sonst waere
    die Registry nach jedem Testlauf (`tests/helpers.ts`) voller temporaerer
    Pfade
  - `kanban boards` — aggregierte Uebersicht aller registrierten Boards
    (Name, Pfad, Task-Zahl); `boards add [pfad]` traegt ein bestehendes Board
    nachtraeglich ein (Name aus `config.json`, sonst Verzeichnisname als
    Fallback), `boards remove <pfad>` entfernt einen Eintrag; `--json` fuer
    maschinelle Auswertung
    - Jedes Board wird einzeln abgefangen, nicht die gesamte Liste in einem
      `try/catch` — ein kaputtes Board zeigt eine Warnzeile (fehlender Pfad,
      kaputte `config.json`, veraltetes Schema, gesperrte Datenbank) statt die
      Uebersicht der anderen Boards mitzureissen
      (`src/cli/board-overview.ts`)
    - Erkennt ein veraltetes Schema (z.B. v2) am Fehlschlag des bestehenden
      Schema-Guards (`assertSchemaCurrent`) und zeigt `Schema vN — 'kanban
      migrate' noetig` statt abzustuerzen oder die Pruefung zu umgehen
    - Frischt den `name`-Cache aus der jeweiligen `config.json` auf und
      schreibt ihn nur zurueck, wenn er wirklich abweicht
    - Reine Lesezugriffe: jede Board-DB wird nur fuer die Dauer der Pruefung
      geoeffnet und sofort wieder geschlossen, keine parallel offenen
      Verbindungen ueber Board-Grenzen hinweg
- Aufwaertssuche fuer die Board-Auffindung (P3-2, Plan Abschnitt 5.4) —
  `kanban list` & Co. funktionieren jetzt auch aus einem Unterverzeichnis
  eines Projekts, analog zu `git`
  - `findBoardUpwards()` (`src/core/db.ts`) sucht von `cwd` aufwaerts, bis ein
    Board gefunden wird oder ein `.git`-Verzeichnis die Projektgrenze
    markiert (wird selbst noch geprueft, dann Abbruch); ohne Git-Repo
    terminiert die Suche hart am Dateisystem-Root statt bis `/` zu laufen
  - Betrifft alle Kommandos ueber `getContext()` (`list`, `add`, `update`,
    `move`, `done`, `status`, `delete`, `get`, `note`, `archive`, `restore`,
    `purge`, `export`, `import`) sowie `kanban tui`
  - **Bewusst NICHT betroffen**: der MCP-Server (`mcp-context.ts` bleibt
    unangetastet — die Verzeichnisbindung ist dort eine Isolationsgrenze
    zwischen Projekten, kein Mangel), `kanban sync` (Entscheidung E-2 — ein
    automatischer Hook mit einem von Claude Code gesetzten `cwd` darf nie
    still ins Board eines Elternprojekts schreiben) sowie `kanban
    migrate`/`kanban init` (die einzige irreversible bzw. eine anlegende
    Operation — wer sie anstoesst, soll dort stehen, wo sie wirkt)
  - 8 neue Tests (`tests/find-board.test.ts`), davon drei automatisierte
    Abgrenzungsnachweise: CLI-Pfad (`getContext()`) findet aufwaerts,
    MCP-Pfad (`withContext()`) findet weiterhin nicht, `kanban sync`
    schreibt nachweislich nichts in ein Elternboard (Subprocess-Test via
    `Bun.spawnSync`, echter CLI-Aufruf mit `cwd` in einem Unterverzeichnis)
- MCP: Task-Abhaengigkeiten vollstaendig ueber MCP nutzbar (vorher nur bei Erstellung setzbar)
  - `kanban_add_dependency` — Task nachtraeglich von einem anderen abhaengig machen
  - `kanban_remove_dependency` — bestehende Abhaengigkeit aufheben (loest gekuerzte IDs auf)
  - `kanban_get_task` liefert jetzt `isBlocked`, `dependsOn` und `dependents` mit
  - Service-Tests fuer Abhaengigkeiten (get/add/remove/isBlocked/Cascade)
- TUI: `a` = Task direkt archivieren (mit Bestaetigungsdialog)
- TUI: Sticky Header/Footer — Header und StatusBar bleiben bei langen Listen sichtbar
- Board Export/Import als ZIP-Archiv
  - `kanban export [output-path]` — Board als ZIP exportieren (board.json + Notes)
  - `kanban import <zip-path>` — Board aus ZIP importieren (`--force` zum Ueberschreiben)
  - MCP Tools: `kanban_export_board`, `kanban_import_board`
  - Exportiert: Config, Spalten, Tasks (inkl. archivierte), Dependencies, Markdown-Notes
  - Import validiert Schema-Version und Dependencies auf existierende Tasks
  - TUI: `E` = Board exportieren, `I` = Board importieren (mit Ueberschreib-Bestätigung)
  - Export-Format v3 (P0-6): `transitions` sowie `priority`/`dueDate` pro Task
    mit im Export; Spalten als geordnetes Array ohne `position`-Feld (analog
    `config.json`, ADR 0001) zusaetzlich zum vollstaendigen `config`-Objekt —
    ein Export bleibt ein vollstaendiger, eigenstaendig lesbarer Snapshot.
    Bewusst **kein** `sourceId`/`source_id` (siehe Plan Abschnitt 0.1)
  - v2-Import (Pflicht, Rueckwaerts-Kompatibilitaet): ein vor der
    Schema-v3-Migration erzeugtes ZIP landet direkt als v3-Board, `kanban
    migrate` ist danach nicht mehr noetig. Spalten-Uebersetzung identisch zur
    Logik aus `kanban migrate` (P0-4, `deriveColumnConfigs` wiederverwendet):
    nach `position` sortiert, Array-Reihenfolge wird zur Ordnung, die ersten
    beiden Spalten werden Eintrittsspalten; `transitions`/`priority`/`dueDate`
    bleiben leer bzw. NULL. Import meldet, welche Spalten Eintrittsspalten
    wurden
  - `importBoard()` liefert jetzt einen `ImportReport` (Quell-Version,
    optionaler Hinweistext) statt `void` — CLI und MCP geben den Hinweistext
    mit aus; die Praesentation bleibt beim Aufrufer, der Service loggt nicht
    selbst (analog `MigrationReport` in `migrate-v3.ts`)
- Markdown-Notizen pro Task (`.kanban/notes/<id>.md`)
  - `kanban add -n "text"` — Notizen beim Erstellen mitgeben
  - `kanban note <id>` — Notizen im `$EDITOR` oeffnen
  - MCP Tools: `notes` Parameter bei `kanban_add_task`, `kanban_update_task`, `kanban_add_task_checked`
  - MCP `kanban_get_task` liefert Notes-Inhalt mit
  - TUI: Notes-Anzeige in Detail-Ansicht, `e` zum Editieren, `[N]`-Indikator auf Task-Karten
  - `hasNotes` Flag bei `listTasks` (Performance: kein Datei-Inhalt laden)
- `TransitionService` (`src/core/transition-service.ts`, P1-1) — Zustandsmaschine
  fuer Spaltenuebergaenge: Regeln pruefen, Pfade berechnen, Transitions
  protokollieren. Seit P1-2 an `TaskService` angebunden (siehe eigener
  Eintrag unten) — hier zunaechst eigenstaendig gebaut und getestet
  - Kettenregel `zielIndex <= quellIndex + 1` wird aus dem Array-Index von
    `boardService.getColumns()` abgeleitet, nicht aus einer hartkodierten
    Matrix — Rueckspruenge beliebiger Weite und `zielIndex == quellIndex`
    (no-op) sind immer erlaubt. Ein Board mit 3 oder 7 Spalten oder
    umsortierten Spalten braucht dafuer keine Codeaenderung
  - `canMove()` prueft zusaetzlich das WIP-Limit der Zielspalte
    (`wipLimit: 0` = unbegrenzt) — das Feld wird damit erstmals durchgesetzt
    statt nur eingefaerbt (TUI-Anzeige in `board-view.tsx`)
  - `canEnter()` prueft `allowEntry`; `canComplete()` leitet die geforderte
    Vorspalte aus dem Index der Terminal-Spalte ab (nicht auf `"review"`
    hartkodiert)
  - Ablehnungstexte sind handlungsleitend (ADR 0002 — kein `force` in
    MCP-Tools, die Ablehnung selbst muss den naechsten Schritt zeigen): sie
    nennen Task, aktuelle und Zielspalte, bei vollem WIP-Limit alle
    blockierenden Tasks samt Wartezeit ("blockiert seit", aus
    `transitions.created_at`, Fallback `tasks.updated_at`) und immer den
    naechsten gueltigen Schritt
  - `reconcilePath()` berechnet Zwischenspalten ohne Regelpruefung —
    ausschliesslich fuer den Sync vorgesehen (P1-7); anderswo verwendet
    wuerde jeder `kanban done` automatisch durch Review durchlaufen
  - `log()`/`history()` schreiben bzw. lesen die `transitions`-Tabelle
    (inkl. `was_override`)
  - 31 neue Tests (`tests/transition-service.test.ts`) — u.a. belegen Boards
    mit 3 und 7 Spalten sowie eine umsortierte `config.json`, dass die Regel
    wirklich abgeleitet und nicht hartkodiert ist
- `TaskService` durchgesetzte Zustandsmaschine (P1-2, siehe Breaking Changes
  unter Changed) — `addTask`/`moveTask`/`completeTask` laufen jetzt durch
  `TransitionService`, jeder Uebergang wird in `transitions` protokolliert
  - `moveTask(id, columnId, opts?)` — neue optionale `opts`:
    `reportedBy`, `reason`, `override` (umgeht Kettenregel, WIP-Limit UND die
    Dependency-Regel vollstaendig, markiert `was_override = 1`; nur fuer den
    kommenden TUI-Bestaetigungsdialog, P1-5) und `wipPolicy: "reject" | "log"`
    (Default `"reject"`; `"log"` laesst NUR einen WIP-Verstoss durch und
    protokolliert ihn als Override mit `reason: "wip-exceeded (sync)"` — die
    Kettenregel bleibt dabei hart. Fuer den kommenden Sync, P1-7, der
    TodoWrite nicht ablehnen kann, weil der Hook erst laeuft, nachdem der
    Agent den Zustand schon gesetzt hat)
  - Neue Dependency-Regel (Teamlead-Entscheidung, ergaenzt die urspruengliche
    P1-2-Spezifikation): ein blockierter Task (`isBlocked`) darf geplant,
    aber nicht bearbeitet werden — ein Vorwaerts-Move in eine Spalte mit
    `allowEntry: false` wird abgelehnt, solange offene Abhaengigkeiten
    bestehen. Rueckwaerts und Moves zwischen Eintrittsspalten bleiben immer
    erlaubt. An `allowEntry` festgemacht statt an einem Spaltennamen, damit
    die Regel wie die Kettenregel aus `config.json` ableitbar bleibt. Der
    Ablehnungstext nennt die offenen Abhaengigkeiten namentlich (ID-Praefix,
    Titel, aktuelle Spalte). Lebt in `TaskService`, nicht in
    `TransitionService`, der bewusst nichts von Abhaengigkeiten weiss
  - `completeTask` prueft zusaetzlich dieselbe Dependency-Regel gegen die
    Terminal-Spalte — ein blockierter Task kann nicht abgeschlossen werden,
    auch wenn er bereits in Review steht
  - `restoreTask` (`ArchiveService`) protokolliert die Wiederherstellung mit
    `reason: "restore"`, ohne Regelpruefung (Ausnahmetabelle aus P1-1) — ein
    archivierter Task hat keinen sinnvollen Kettenzustand
  - `TransitionCheck` (transition-service.ts) bekommt ein neues optionales
    Feld `violation?: "chain" | "wip"`, damit `moveTask` bei `wipPolicy:
    "log"` gezielt nur WIP-Ablehnungen umleiten kann, ohne die Kettenregel
    anzufassen — additive Erweiterung, keine bestehenden Aufrufer betroffen
  - `TaskService`/`ArchiveService` bauen `TransitionService` intern selbst
    (Konstruktor-Signatur unveraendert: `db`, `boardService`, `notesService`)
    — alle bestehenden Konstruktionsstellen (TUI, MCP, CLI, Sync, Skripte)
    funktionieren ohne Anpassung weiter
  - 24 neue Tests (`tests/task-service-transitions.test.ts`)
- `reportedBy` als Pflichtfeld (P1-3) in den vier MCP-Tools, die eine
  Transition erzeugen: `kanban_add_task`, `kanban_add_task_checked`,
  `kanban_move_task`, `kanban_complete_task`. Wortgleiche Schema-Beschreibung
  in allen vieren (`src/mcp/schemas.ts`, `reportedBySchema`) — zaehlt
  konkrete Rollennamen auf (`planer`, `backend`, `frontend`,
  `code-reviewer`, `teamlead`, `explorer`, sonst `user`) statt nach einem
  freien String zu fragen: ein Agent, der eine Liste sieht, waehlt daraus,
  einer der frei gefragt wird, schreibt "claude". Bewusst `z.string()`, kein
  `z.enum()` — die Rollenliste ist projektspezifisch. Getrennt von
  `createdBy` (K-3): der Wert landet ausschliesslich in
  `transitions.reported_by`, nie auf dem Task selbst; `AddTaskInput`/
  `TaskService.completeTask` bekommen dafuer ein eigenes optionales
  `reportedBy`-Feld, ohne Fallback auf `createdBy` (Default `"user"`).
  `kanban_update_task`, `kanban_delete_task` und alle lesenden Tools bleiben
  unangetastet; `kanban_restore_task` protokolliert weiterhin fest `"user"`
  (siehe P1-2, keine Regelpruefung fuer Restore). CLI: neues `--by <name>`
  an `add`/`move`/`done`, Default `"user"`, kein Prompt in der TUI
- MCP-Ablehnungen tragen jetzt durchgehend `isError: true` (P1-4, ADR 0002).
  Betraf konkret nur `kanban_add_task_checked` — alle anderen Tools nutzten
  bereits denselben try/catch, der `TaskService`-Fehler (inkl. der neuen
  P1-1/P1-2-Ablehnungstexte) automatisch mit `isError: true` durchreicht
  - `kanban_add_task_checked`: `force` bleibt erhalten (Duplikat-Erkennung
    ist eine fehlbare Heuristik, `src/core/similarity.ts` — ein WIP-Zaehler
    ist das nicht), aber verschwindet aus Tool-Beschreibung, `.describe()`
    und Ablehnungstext — eine Ablehnung, die ihren eigenen Umgehungsweg
    mitliefert, ist keine Ablehnung. Die Ablehnung nennt jetzt Titel **und
    IDs** der aehnlichen Tasks (vorher nur Titel), damit ein Agent pruefen
    kann, ob einer davon sein Anliegen abdeckt, statt zu raten
  - `TaskService.addTaskChecked`s `rejectionReason` verliert denselben
    "Verwende --force"-Hinweis (`task-service.ts`)
  - Neue Tests `tests/mcp-tools.test.ts` (14 Tests) — echter MCP-Client/
    Server-Roundtrip ueber `InMemoryTransport` (kein Mock), damit die
    Tool-Antworten genauso getestet werden, wie ein Agent sie sieht

- Override-Dialog in der TUI (P1-5, ADR 0002) — die einzige Stelle im Werkzeug,
  an der eine Regel bewusst gebrochen werden darf. `moveTask`/`completeTask`
  (`src/tui/use-board.ts`) werfen nicht mehr, sondern liefern
  `{ ok, reason }`; bei Ablehnung zeigt `OverrideConfirm`
  (`src/tui/status-bar.tsx`) den **vollen** Ablehnungstext aus
  `TransitionService` — blockierende Tasks, Standzeiten, naechster gueltiger
  Schritt — bevor `y` denselben Aufruf mit `{ override: true }` wiederholt
  (bestehender Pfad aus P1-2, kein zweiter Umgehungsweg). Betrifft
  Verschiebe-Modus (Pfeiltasten) und `d` (Done); `t` (Backlog→Todo) bleibt
  ohne Dialog (strukturell immer legal), zeigt eine Ablehnung aber trotzdem
  an, statt sie zu verschlucken
  - Eintrittsregel beim Anlegen (`n`): steht der Cursor auf einer Spalte ohne
    `allowEntry`, wird der Task still in Todo angelegt (Statuszeile: "Neue
    Tasks nur in Backlog oder Todo — angelegt in Todo"), Cursor springt
    dorthin, kein Override-Dialog — anlegen ist eine Fehlbedienung, keine
    Ausnahme
  - Tastatur-Kaskade nach `src/tui/use-input-modes.ts` ausgelagert: der
    Override-Dialog haette `app.tsx` ueber die 420-Zeilen-Stoppgrenze aus den
    Task-Notes getrieben (zwischenzeitlich 462 Zeilen); reine
    Verhaltens-Verschiebung (kein State-Owner-Wechsel), wie in den Notes als
    Kandidat benannt
- Verwaiste Tasks sichtbar gemacht (P1-6, ADR 0001): virtuelle Sammelspalte
  `⚠ Ohne Spalte` ganz rechts in der TUI (`src/tui/use-board.ts`:
  `displayColumns`/`isOrphanTask`, `src/tui/board-view.tsx`), nur wenn
  tatsaechlich Waisen existieren. Aus ihr heraus ist jeder Move erlaubt
  (Transition mit `reason: "orphan-recovery"`). `kanban status` weist Waisen
  jetzt separat aus (Text **und** `--json`) und rechnet sie in `total` ein
  (`src/cli/formatters.ts`, `src/cli/commands/status.ts`) —
  `TaskService.getStatus()` selbst bleibt unangetastet, die Korrektur passiert
  in der CLI-Schicht (Core-Grenze dieses Tasks, siehe Bericht an team-lead)
- **`kanban sync` funktioniert jetzt tatsaechlich** (P1-7). Keine Erweckung im
  Sinne einer Regression, sondern die erste je funktionierende Fassung: der
  Konstruktor-Bug (`TaskService` mit 2 statt 3 Argumenten) machte jeden Lauf
  gegen ein nicht-leeres Board unbrauchbar, seit die Datei existiert
  - Logik nach `src/core/sync-service.ts` ausgelagert (`syncTodos()`),
    `sync.ts` bleibt reine CLI-Huelle (stdin lesen, parsen, Bericht auf
    stderr) — sonst waere die Logik nur ueber simuliertes stdin testbar
  - `TodoItem`-Interface korrigiert: `content`, `status`
    (`pending`/`in_progress`/`completed`), `activeForm` (bekannt, bewusst
    ungenutzt — `content` traegt die relevante Information). **Kein** `id`,
    **kein** `priority` — beide existieren im echten TodoWrite-Payload nicht
    (Plan Abschnitt 0.1, belegt aus drei unabhaengigen Quellen). Der
    `cancelled`-Zweig in `STATUS_TO_COLUMN` entfaellt als toter Code, ein
    unbekannter `status`-Wert faellt auf `todo` zurueck statt abzustuerzen
  - Content-Matching gehaertet und **deterministisch**: bei mehreren
    gleichnamigen Tasks gewinnt der aelteste nicht archivierte
    (`created_at ASC`), nicht der erste in Listenreihenfolge (die haengt an
    `position`, die sich bei jedem Verschieben aendert — derselbe Sync traf
    bisher je nach Board-Zustand einen anderen Task). Archivierte Tasks
    werden nie getroffen; ein in diesem Lauf bereits getroffener Task matcht
    nicht erneut, sonst kollabieren zwei gleichnamige Todos auf einen Task
  - Reconcile: ein Todo meldet einen Zielzustand, `TransitionService.
    reconcilePath()` (P1-1) berechnet die Zwischenspalten, jeder Schritt eine
    eigene Transition (`reportedBy: "sync"`, `reason: "reconcile"`). Ein
    neuer, sofort `completed` gemeldeter Todo erzeugt so vier Transitions
    (Entstehung + drei Reconcile-Schritte) mit Zeitstempeln in derselben
    Sekunde — bewusster Preis fuer die Kettenintegritaet, nicht
    "wegoptimierbar". `reconcilePath()` bleibt ausschliesslich fuer diesen
    Zweck reserviert (P1-1)
  - WIP-Ueberschreitungen werden protokolliert statt abgelehnt
    (`moveTask(..., { wipPolicy: "log" })` aus P1-2: `was_override: true`,
    `reason: "wip-exceeded (sync)"`), plus eine Zeile auf stderr — TodoWrite
    selbst laesst sich nicht ablehnen, der Hook laeuft, nachdem Claude Code
    den Zustand bereits gesetzt hat. Die Kettenregel bleibt dabei hart
  - Ein Task, der laut TodoWrite weiterlaufen soll, im Board aber durch eine
    offene Abhaengigkeit blockiert ist (P1-2), wird **uebersprungen** —
    bleibt unveraendert stehen, keine Transition, kein Override. Anders als
    WIP (ein einmaliges Ereignis) ist eine offene Abhaengigkeit ein
    ANDAUERNDER Zustand, der Stunden oder Tage bestehen kann; ihn wie einen
    echten Fehler zu behandeln liesse jeden Sync-Lauf scheitern, solange die
    Abhaengigkeit offen ist — derselbe Dauerfehler, fuer den P0-5 bereits
    "Exit 0, stderr" statt "Exit 1" entschieden hat. Zaehlt als `skipped`,
    stderr nennt Task und wartende Abhaengigkeit(en) namentlich. Rueckwaerts
    bleibt fuer einen blockierten Task immer erlaubt (dieselbe Ausnahme wie
    bei der Dependency-Regel selbst), alle uebrigen Todos desselben Payloads
    laufen unbeeinflusst weiter. `TaskService.canMoveWhileBlocked()` ist
    dafuer public geworden (vorher privat) — sync-service.ts nutzt dieselbe
    Pruefung, statt die Regel ein zweites Mal zu implementieren
  - Die gesamte Sync-Schleife laeuft in **einer Transaktion**
    (`db.transaction()`): bricht ein Schritt mit einem ECHTEN Fehler ab (z.B.
    eine Zielspalte, die auf dem Board gar nicht existiert), wird fuer den
    ganzen Lauf nichts geschrieben, statt einen halb synchronisierten
    Zustand zu hinterlassen
  - Verschwundene Todos werden weiterhin ignoriert (kein Loeschen/Archivieren
    — aus dem Payload nicht von einer gekuerzten Liste unterscheidbar),
    Priority-Uebernahme bleibt aus (Feld existiert nicht), Schema-Guard bleibt
    bei Exit 0 mit Meldung auf stderr (P0-5)
  - **Bekannte, nicht behebbare Einschraenkung** (README): TodoWrite liefert
    keine Identitaet ueber Aufrufe hinweg. Wird ein aus einem Todo
    entstandener Task umbenannt, erzeugt der naechste Sync einen zweiten Task
  - 17 neue Tests (`tests/sync-service.test.ts`)
- `priority` und `dueDate` durchgereicht (P2-1/P2-2). Die Spalten existieren
  seit Schema v3 (Paket 0) in der DB, wurden aber bisher nirgends gesetzt
  oder gelesen — `rowToTask` fuellte sie, danach verschwanden sie. Echte
  Spalten statt Labels, weil nur eine Spalte eine Ordnung hat: `priority:high`
  als Label waere filterbar, aber nicht sortierbar gewesen
  - `TaskService.addTask`/`updateTask` validieren `priority` (nur `high`,
    `medium`, `low`) und `dueDate` (`YYYY-MM-DD`, **inklusive
    Kalendergueltigkeit** — `2026-02-31` ist syntaktisch korrekt und trotzdem
    ungueltig; `new Date()` allein rollt sowas still auf einen anderen Tag um
    und wirft nicht, deshalb ein Rueckvergleich von Jahr/Monat/Tag statt eines
    reinen Parse-Versuchs). Vergangene Faelligkeiten bleiben erlaubt — man
    traegt auch Ueberfaelliges nach. Validierung lebt in `types.ts`
    (`assertValidTaskPriority`, `assertValidDueDate`), aufgerufen aus dem
    Service, nicht aus CLI oder MCP-Schema — damit eine ungueltige Eingabe
    immer dieselbe, die gueltigen Werte aufzaehlende Fehlermeldung bekommt
  - `Task.isOverdue` (abgeleitet, nicht gespeichert):
    `dueDate < heute && !archived && Spalte nicht terminal`. Vergleich auf
    Datums-, nicht Zeitstempelebene — heute faellig ist nicht ueberfaellig.
    "Heute" in lokaler Zeit, nicht UTC (`TaskService.isOverdue`, optionaler
    `today`-Parameter fuer deterministische Tests). Gesetzt in `getTask()`
    und `listTasks()`, analog zu `isBlocked` nicht in `rowToTask`
  - `TaskService.listTasks`: Filter `priority` und `overdue`, sowie
    `sort: "priority" | "due" | "position"` (lose typisiert, ein unbekannter
    Wert faellt auf die Default-Sortierung zurueck statt zu werfen —
    Sortierung ist eine Praesentationsfrage, keine Regel). Tasks ohne
    Prioritaet bzw. ohne Faelligkeit sortieren ans Ende, nicht als
    "medium"/"heute faellig". Ohne `sort`-Angabe bleibt es bei
    `position ASC, created_at ASC`, sonst zerreisst es die manuelle
    Reihenfolge aus `reorderTask`/TUI
  - CLI: `-p, --priority` und `--due` an `add`; `--priority`, `--overdue`,
    `--sort` an `list`
  - **Neu: `kanban update <id>`** (`src/cli/commands/update.ts`) — es gab
    bisher **kein** CLI-Kommando zum Aendern eines bestehenden Tasks (nur
    `note` fuer Notizen); ohne das liesse sich eine Prioritaet nachtraeglich
    nur ueber MCP oder TUI setzen
  - `formatTask`/`formatTaskDetail`: Prioritaets- und Faelligkeitsmarker,
    ueberfaellig in Rot mit `⚠` (derselbe Marker wie bei Waisen-Tasks)
  - MCP: `priority`/`dueDate` optional bei `kanban_add_task`,
    `kanban_add_task_checked`, `nullable` zum Zuruecksetzen bei
    `kanban_update_task`; `priority`-Filter und `overdue`-Flag bei
    `kanban_list_tasks`. Bewusst `z.string()` statt `z.enum()` im
    Zod-Schema — eine ungueltige Eingabe soll `TaskService`s Fehlermeldung
    durchreichen, nicht Zods generische Enum-Meldung. `kanban_get_task`
    liefert `priority`/`dueDate`/`isOverdue` automatisch mit (ueber
    `rowToTask` bzw. die neue `isOverdue`-Zuweisung), keine Aenderung an
    dem Tool selbst noetig
  - Sync fasst `priority`/`dueDate` nicht an (eigens getestet) — das Feld
    wird ausschliesslich von Hand gepflegt, TodoWrite liefert es nicht
    (Plan Abschnitt 0.1/4.5; P2-4 "Priority aus TodoWrite" ist ersatzlos
    gestrichen)
  - 26 neue Tests (`tests/task-metadata.test.ts`) + 8 neue MCP-Tests
    (`tests/mcp-tools.test.ts`)
- Prioritaet und Faelligkeit in der TUI (P2-3). Ueberfaellig-Marker auf der
  Karte, Prioritaet + Faelligkeitsdatum in der Detailansicht (K-2: eine
  Prioritaet kann man nachschlagen, eine verpasste Frist nicht — der knappe
  Platz auf der Karte gehoert dem Wert, den man nirgends sonst findet)
  - `TaskCard`: `[!]` (Orange, `ACCENT.overdue`) vor `[B]`/`[N]`, nur wenn
    `task.isOverdue` — wird fertig vom `TaskService` geliefert, nicht in der
    TUI nachgerechnet. Eigener Ton statt Wiederverwendung von `wipWarn`
    (Blockiert-Rot): ein Task kann gleichzeitig blockiert und ueberfaellig
    sein, zwei Klammer-Marker in identischer Farbe waeren auf der schmalen
    Karte schwerer auseinanderzuhalten. Prioritaet erscheint bewusst NICHT
    auf der Karte (K-2)
  - `DetailView`: neue Zeilen "Prioritaet: Hoch/Mittel/Niedrig/—" und
    "Faellig: <Datum>/— (ueberfaellig)"
  - Prioritaet ist in der TUI setzbar (Taste `p` in der Detailansicht) —
    `PriorityPicker` (`src/tui/priority-picker.tsx`, neue Datei, analog zu
    `TagPicker`): Einfachauswahl aus vier Zustaenden (high/medium/low/keine)
    mit Radio-Marken `( )`/`(x)` statt der Checkbox-Marken `[ ]`/`[x]` aus
    `TagPicker` (Einfach- vs. Mehrfachauswahl). **Kein Texteingabefeld** —
    vier gueltige Zustaende sind eine Auswahl, kein Freitext
  - `dueDate` bleibt in der TUI bewusst nur lesbar (CLI/MCP setzen es
    weiterhin): ein Datum ist unbeschraenkter Freitext mit strenger
    Kalender-Validierung (`assertValidDueDate` wirft), waehrend
    `useBoard().updateTask()` Service-Fehler nicht abfaengt — ein
    Freitext-Editor waere die erste Eingabe der TUI, die fehlschlagen und
    einen Fehlerpfad brauchen kann, kein gleich grosser Folgeschritt zum
    Prioritaets-Picker
  - Board-Ansicht nach Prioritaet sortierbar (Taste `s`, reiner Ansichtsmodus):
    nutzt `TaskService.listTasks({ sort: "priority" })` (P2-1) ueber
    `loadData()`/`useBoard()`, sortiert nie serverseitig neu in der TUI.
    Schreibt nirgends `position` (rein lesender Pfad, per Test nachgewiesen) —
    das Feld traegt die manuelle Reihenfolge aus dem Verschiebe-Modus. Im
    Verschiebe-Modus abgeschaltet (`resolveEffectiveSort()`, `src/tui/use-board.ts`),
    sonst springt die Karte unter dem Cursor weg, waehrend man sie bewegt
  - 33 neue Tests (`tests/theme.test.ts`, `tests/task-card.test.tsx`,
    `tests/detail-view.test.tsx`, `tests/priority-picker.test.tsx`,
    Erweiterung von `tests/use-board.test.ts`) — Komponenten-Tests ueber Inks
    `renderToString()` (bereits Projekt-Abhaengigkeit, kein `ink-testing-library`
    noetig); Tastatur-Interaktion bleibt manuell zu verifizieren
    (`useInput()` ist ohne TTY ein No-Op)

### Removed

- `plugins/ralph-tracker` — das Tracker-Plugin fuer [Ralph TUI](https://github.com/subsy/ralph-tui)
  ist ersatzlos entfernt, samt seiner deployten Kopie unter
  `~/.config/ralph-tui/plugins/trackers/`
  - Damit entfaellt der einzige externe Konsument von `kanban status --json`
    und `kanban list --json`. Das Ausgabeformat dieser beiden Kommandos ist
    kein Vertrag mehr gegenueber Dritten
  - Die Testsuite ist dadurch wieder vollstaendig gruen: der Test des Plugins
    rief das global installierte `/opt/homebrew/bin/kanban` auf, einen Wrapper
    auf ein **anderes** Repository, und schlug seit Laengerem sporadisch fehl

### Changed

- **Breaking (P1-2):** `TaskService.addTask` akzeptiert nur noch Spalten mit
  `allowEntry: true` (Default-Board: `backlog`, `todo`) — `addTask({columnId:
  "in-progress"})` etc. wirft jetzt einen Fehler statt zu erstellen
- **Breaking (P1-2):** `TaskService.moveTask` und `completeTask` koennen
  ablehnen. `kanban done`/`kanban_complete_task` scheitert, wenn der Task
  nicht in der Spalte direkt vor der Terminal-Spalte steht (Default: Review);
  `moveTask` scheitert bei Kettenverstoss (mehr als ein Schritt vorwaerts),
  vollem WIP-Limit der Zielspalte oder — neu — wenn der Task blockiert ist
  und vorwaerts in eine Arbeitsspalte soll (siehe Added). Betroffene
  bestehende Aufrufer, noch nicht angepasst (folgt in eigenen Tasks):
  `src/tui/app.tsx` (`n`/`d`/Verschiebe-Modus — Override-Dialog folgt in
  P1-5), `scripts/seed-demo.ts` (legt Tasks z.T. direkt in mittleren Spalten
  an). Das README-Beispiel `-c in-progress` ist mit P1-3 korrigiert (siehe
  unten)
- **Breaking (P1-3):** `kanban_add_task`, `kanban_add_task_checked`,
  `kanban_move_task`, `kanban_complete_task` verlangen jetzt `reportedBy`.
  Bestehende Agent-Konfigurationen, die diese vier MCP-Tools ohne das Feld
  aufrufen, scheitern mit einem Zod-Validierungsfehler, bis sie es mitgeben
- **Breaking (P1-4):** `kanban_add_task_checked` nennt bei einer Ablehnung
  nicht mehr nur Titel, sondern Titel und IDs der aehnlichen Tasks, und
  traegt jetzt `isError: true` (vorher fehlte das Flag komplett — eine
  Ablehnung sah fuer ein Modell wie ein Erfolg mit Hinweis aus)
- `BoardService` liest Spalten jetzt aus `config.json` statt per SQL aus der
  `columns`-Tabelle (`getColumns`, `getColumn`, `getTerminalColumn`); die
  `columns`-Tabelle entfaellt, `tasks.column_id` hat keinen Fremdschluessel
  mehr darauf. `getColumnTaskCount` bleibt SQL — zaehlt Tasks, nicht Spalten
- DB-Schema-Version 2 → 3. `openDb()` migriert nicht mehr automatisch beim
  Oeffnen (bisheriges `migrateDb()` entfernt) — `assertSchemaCurrent()` in
  `db.ts` (P0-5, exportiert, ersetzt die P0-1-Notbremse
  `assertSchemaNotStale`) prueft bei jedem Oeffnen die Version und verweigert
  den Start bei Abweichung. Eine zu niedrige Version nennt Pfad und
  Projektordner fuer `kanban migrate`; eine zu hohe Version (aelterer Client
  an einem neueren Board) bekommt eine eigene Meldung ("Aktualisiere
  kanban-mcp") statt des dort falschen Migrations-Rats
  - Greift einheitlich an allen Einstiegspfaden: CLI (`kanban list` etc.) und
    TUI brechen formatiert mit Exit 1 ab, MCP-Tools liefern `isError: true`,
    `kanban export` verweigert sich ohne ZIP zu erzeugen
  - Ausnahme `kanban sync`: Meldung auf **stderr**, **Exit 0** — ein Hook, der
    einen Agenten-Turn mit Exit 1 stoert, richtet mehr Schaden an als ein
    ausgefallener Sync (bestehende Konvention aus P0-1 fortgesetzt)
  - Ausgenommen (rufen `openDb()` bewusst nicht auf): `kanban migrate` selbst,
    `initBoard()`, `importBoard()` — legen die DB immer frisch als v3 an
  - Das Migrationskommando existiert (`kanban migrate`, siehe Added); bis ein
    Board migriert ist, bleibt es bei diesem Abbruch beim Oeffnen

### Fixed

- `kanban sync` konstruierte `TaskService` mit nur 2 statt 3 Argumenten
  (`notesService` fehlte) — jeder Sync-Lauf gegen ein nicht-leeres Board brach
  mit `undefined is not an object (evaluating 'this.notesService.exists')` ab
- MCP `kanban_purge_archive` las `result.purgedCount` statt `result.deletedCount`
  und lieferte deshalb `undefined` in der Tool-Antwort statt der echten Anzahl
- `bunx tsc --noEmit` bereinigt (24 vorbestehende Fehler, davon 13 durch
  `SQLQueryBindings`-Aufrufsyntax in `task-service.ts`/`archive-service.ts`,
  Rest Null-Checks unter `noUncheckedIndexedAccess` sowie ein totes,
  in ink 6.8.0 nie gelesenes `fullScreen`-Feld in `kanban tui`) — reine
  Aufrufsyntax-/Typ-Fixes, keine Verhaltensaenderung
- `src/tui/use-board.ts` las `config.json` zweimal pro `loadData()`-Aufruf
  (einmal in `createServices()`, danach direkt nochmal in `loadData()` selbst)
  — jeder Refresh in der TUI (nach jeder schreibenden Aktion, bei jedem
  `fs.watch`-Ereignis) las, parste und validierte die Config doppelt, dazu ein
  theoretisches Konsistenzfenster zwischen beiden Lesevorgaengen (GitHub #35).
  `loadData()` nutzt jetzt nur noch die eine `BoardService`-Instanz aus
  `createServices()`; ein Zaehler-Spy-Test (`tests/use-board.test.ts`, via
  `mock.module`) haelt fest, dass `loadBoardConfig` pro Aufruf genau einmal
  laeuft

## [0.1.0] - 2026-03-03

### Added

- Board-Initialisierung mit SQLite (`kanban init`)
- Task CRUD: erstellen, lesen, aktualisieren, loeschen
- Task verschieben zwischen Spalten (Backlog, Todo, In Progress, Review, Done)
- Task abschliessen (`kanban done`)
- Board-Status mit Task-Zahlen pro Spalte
- CLI mit 11 Subcommands (init, add, list, move, done, status, delete, archive, restore, purge, tui)
- MCP Server mit 14 Tools fuer Claude Code Integration (stdio Transport)
- Terminal UI (TUI) mit ink + React
  - Spalten-basierte Board-Ansicht mit Farbcodierung
  - Tastatur-Navigation zwischen Spalten und Tasks
  - Task-Erstellung direkt im TUI (`n`)
  - Task-Loeschen mit Bestaetigung (`x`)
  - Filter/Suche nach Titel (`/`)
  - Hilfe-Overlay (`?`)
  - Task-Details, Verschieben, Done-Markierung
- Archiv-Management: archivieren, wiederherstellen, purgen, Statistiken
- Duplikat-Erkennung mit Trigram + Wort-basierter Similarity
- TodoWrite Sync Hook fuer automatische Kanban-Updates
- Pro-Projekt SQLite Datenbank in `.kanban/` Verzeichnis
- Prefix-basierte Task-ID Suche (Kurzform moeglich)
- Unit-Tests mit bun:test (64 Tests)
