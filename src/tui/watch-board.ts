// Beobachtung des Board-Verzeichnisses: meldet, wenn ein fremder Prozess an
// dasselbe Board schreibt (MCP-Agent, zweite CLI, zweite TUI).
//
// Bewusst React-frei und ohne Kenntnis von State oder Hooks -- der einzige
// Bezug zur TUI ist, dass 'use-board.ts' den Reload ausloest. Dadurch laesst
// sich die Logik gegen ein echtes Verzeichnis testen, ohne einen React-Renderer
// zu brauchen (im Repo gibt es dafuer kein Werkzeug, und eine neue Dependency
// dafuer waere ohne Ruecksprache nicht drin).
import { watch, type FSWatcher } from "node:fs";

const BOARD_DB_PREFIX = "board.db";

// Der gemeinsame Speicher des WAL-Index -- die eine Datei, die auch ein reiner
// LESEVORGANG anfasst, weil `openDb()` sie beim Oeffnen anlegt bzw. beim
// Schliessen wieder abraeumt. Sie meldet damit nicht, dass sich Daten geaendert
// haben, sondern nur, dass jemand hingeschaut hat -- auch dann, wenn dieser
// jemand unser eigenes refresh() war.
//
// Zaehlte der Filter sie mit, waere der Watcher an seine eigene Wirkung
// zurueckgekoppelt: lesen, Ereignis, Reload, lesen. Gemessen auf einem
// Wegwerf-Board, ein Anstoss und danach keine fremde Aenderung: 49 Reloads in
// 3 Sekunden, jeder mit drei setState -- in der TUI als Dauerflackern sichtbar.
//
// Fremde Schreibvorgaenge bleiben trotzdem sichtbar: die landen im WAL selbst
// (`board.db-wal`), nicht in dessen Index.
const WAL_INDEX_FILE = `${BOARD_DB_PREFIX}-shm`;

// Ob eine Dateiaenderung im Board-Verzeichnis einen Reload rechtfertigt.
//
// Rein und exportiert, damit die Filterregel ohne Timing und ohne zweiten
// Prozess pruefbar ist -- der Kreislauf, den sie verhindert, laesst sich sonst
// nur ueber Wartezeiten nachweisen.
export function isBoardChange(filename: string | null): boolean {
  // Ohne Dateinamen (kommt auf manchen Plattformen vor) im Zweifel neu laden:
  // ein ueberzaehliger Reload ist harmlos, ein verpasster kostet Vertrauen.
  if (!filename) return true;
  if (!filename.startsWith(BOARD_DB_PREFIX)) return false;
  return filename !== WAL_INDEX_FILE;
}

// Beobachtet ein Board-Verzeichnis und meldet fremde Aenderungen (MCP-Agent,
// zweite CLI, zweite TUI). Liefert die Abmelde-Funktion zurueck.
//
// Beobachtet wird das VERZEICHNIS, nicht `board.db`. Gemessen (GitHub #43):
// Ein fremder Prozess schreibt in den WAL und laesst `board.db` unberuehrt --
// mtime und size bleiben identisch, und ein `fs.watch` auf die Datei feuert
// deshalb nie. Auch `fs.watchFile` (Polling auf stat) sieht so einen
// Schreibvorgang nicht. Das Verzeichnis-Watch sieht ihn zuverlaessig, weil dort
// `board.db-wal` auftaucht und sich aendert. Die Datei wird dabei nicht ersetzt
// (Inode unveraendert) -- der alte Watcher war nicht kaputt, er sah nur an der
// falschen Stelle nach.
export function watchBoardChanges(
  kanbanDir: string,
  onChange: () => void,
  debounceMs = 50,
): () => void {
  let watcher: FSWatcher;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    watcher = watch(kanbanDir, (_type, filename) => {
      // config.json, notes/ und der WAL-Index loesen keinen Board-Reload aus --
      // warum gerade der Index nicht, steht bei WAL_INDEX_FILE.
      if (!isBoardChange(filename)) return;
      // Ein Schreibvorgang erzeugt ein bis zwei Ereignisse (DB und WAL) --
      // entprellen statt zaehlen, sonst laedt ein einzelner Move doppelt neu.
      clearTimeout(timer);
      timer = setTimeout(onChange, debounceMs);
    });
  } catch {
    // Kein Watch moeglich (Verzeichnis weg, Limit erreicht): die TUI laeuft
    // weiter, nur ohne Auto-Refresh -- 'r' aktualisiert weiterhin von Hand.
    return () => {};
  }
  return () => { clearTimeout(timer); watcher.close(); };
}
