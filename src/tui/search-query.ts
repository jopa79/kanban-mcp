// Reine Suchlogik fuer den Sprung-Suchmodus (Taste "g", GitHub #51). Kein
// React, kein useInput, kein Dateizugriff -- die Datei ist bewusst so klein
// gehalten, dass sie ohne Ink-Mount getestet werden kann (siehe
// tests/search-query.test.ts, Stil wie tests/line-input.test.ts).
//
// Plan .claude/plans/tui-search-jump.md, Abschnitt 5. Die Waisen-Regel (ein
// Task gehoert zur virtuellen Sammelspalte, wenn seine columnId in keiner
// echten Spalte steckt) ist identisch zu app.tsx:80 und board-view.tsx:55/61
// -- importiert aus use-board.ts statt neu zu implementieren, damit die Regel
// an genau einer Stelle lebt (siehe Plan Abschnitt 2.4 / 9, Review Runde 4).
import type { Column, Task } from "../core/types.ts";
import { ORPHAN_COLUMN_ID } from "../core/types.ts";
import { isOrphanTask } from "./use-board.ts";

// Praefixe des Datumsfilter-Tokens, in beiden Schreibweisen. Laenge wird
// weiter unten gebraucht, um den Wert nach dem Doppelpunkt abzuschneiden.
const DUE_PREFIX_ASCII = "faellig:";
const DUE_PREFIX_UMLAUT = "fällig:";

// Vollstaendige, gueltige Form JJJJ-MM oder JJJJ-MM-TT MIT Bereichspruefung
// (Monat 01-12, Tag 01-31). Plan Abschnitt 3, Regel "prefix".
const FULL_DATE_REGEX = /^(\d{4})-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

// Obergrenze fuer Notiztexte im Suchindex, damit ein Board mit langen Notizen
// den Index nicht in den Megabyte-Bereich treibt (Plan Abschnitt 5).
export const NOTES_INDEX_LIMIT = 4096;

export interface SearchQuery {
  textTerms: string[]; // bereits kleingeschrieben
  // Drei nutzbare Zustaende plus "none" (kein Token vorhanden), siehe Plan
  // Abschnitt 3 "Syntax": kein/unvollstaendiger Datumsfilter wird ignoriert,
  // nur ein vollstaendiger filtert, nur ein unrettbar ungueltiger zeigt den
  // Hinweis.
  due:
    | { kind: "none" }
    | { kind: "pending" } // "faellig:" oder "faellig:2026-0"
    | { kind: "prefix"; value: string } // "2026-09" oder "2026-09-03"
    | { kind: "invalid"; raw: string }; // "morgen"
}

// Prueft stellenweise, ob 'value' noch zu einem vollstaendigen, gueltigen
// Datum (JJJJ-MM oder JJJJ-MM-TT) werden KANN. Keine Monster-Regex (Plan
// Abschnitt 3): Ziffer an Ziffernposition, Bindestrich an Position 4 und 7,
// Monatszehner 0 oder 1 mit passendem Monatseiner, Tageszehner 0-3 mit
// passendem Tageseiner. Leerer String ist ein gueltiges Praefix (Zustand
// "pending" beginnt bei nichts getippt).
function isPendingDatePrefix(value: string): boolean {
  if (value.length > 10) return false;

  for (let i = 0; i < value.length; i++) {
    const c = value[i] as string;
    switch (i) {
      case 0:
      case 1:
      case 2:
      case 3:
        if (!/\d/.test(c)) return false;
        break;
      case 4:
        if (c !== "-") return false;
        break;
      case 5:
        if (c !== "0" && c !== "1") return false;
        break;
      case 6: {
        const monthTens = value[5];
        if (monthTens === "0") {
          if (!/[1-9]/.test(c)) return false;
        } else {
          // monthTens === "1" (sonst waere idx 5 schon gescheitert)
          if (!/[0-2]/.test(c)) return false;
        }
        break;
      }
      case 7:
        if (c !== "-") return false;
        break;
      case 8:
        if (!/[0-3]/.test(c)) return false;
        break;
      case 9: {
        const dayTens = value[8];
        if (dayTens === "3") {
          if (!/[01]/.test(c)) return false;
        } else {
          if (!/\d/.test(c)) return false;
        }
        break;
      }
      default:
        return false;
    }
  }
  return true;
}

// Ermittelt den Datumszustand fuer den Wert NACH dem Praefix ("faellig:"
// bzw. "fällig:"). Pruefreihenfolge bewusst: ERST die vollstaendige Form,
// DANN die Praefix-Pruefung -- "2026-09" ist beides und muss "prefix"
// ergeben (Plan Abschnitt 3).
function classifyDueValue(value: string): SearchQuery["due"] {
  if (FULL_DATE_REGEX.test(value)) return { kind: "prefix", value };
  if (isPendingDatePrefix(value)) return { kind: "pending" };
  return { kind: "invalid", raw: value };
}

export function parseSearchQuery(raw: string): SearchQuery {
  const normalized = raw.normalize("NFC").toLowerCase();
  const tokens = normalized.trim().split(/\s+/).filter((t) => t.length > 0);

  const textTerms: string[] = [];
  let due: SearchQuery["due"] = { kind: "none" };

  for (const token of tokens) {
    if (token.startsWith(DUE_PREFIX_ASCII)) {
      due = classifyDueValue(token.slice(DUE_PREFIX_ASCII.length));
    } else if (token.startsWith(DUE_PREFIX_UMLAUT)) {
      due = classifyDueValue(token.slice(DUE_PREFIX_UMLAUT.length));
    } else {
      textTerms.push(token);
    }
  }

  return { textTerms, due };
}

export interface SearchEntry {
  task: Task;
  haystack: string; // title + description + notes + id, kleingeschrieben
}

// loadNotes wird injiziert, damit der Index ohne Dateisystem testbar ist. Nur
// fuer hasNotes === true aufgerufen. Liefert der Loader null (Datei manuell
// geloescht), zaehlt die Notiz als leer. Notizen werden auf
// NOTES_INDEX_LIMIT Zeichen gekappt.
export function buildSearchIndex(
  tasks: Task[],
  loadNotes: (taskId: string) => string | null,
): SearchEntry[] {
  return tasks.map((task) => {
    let notesText = "";
    if (task.hasNotes === true) {
      const loaded = loadNotes(task.id);
      if (loaded !== null) {
        notesText = loaded.length > NOTES_INDEX_LIMIT
          ? loaded.slice(0, NOTES_INDEX_LIMIT)
          : loaded;
      }
    }

    const haystack = [task.title, task.description ?? "", notesText, task.id]
      .join(" ")
      .normalize("NFC")
      .toLowerCase();

    return { task, haystack };
  });
}

export function matchesQuery(entry: SearchEntry, query: SearchQuery): boolean {
  if (query.due.kind === "invalid") return false;

  if (query.due.kind === "prefix") {
    const dueDate = entry.task.dueDate;
    if (dueDate === null || dueDate === undefined) return false;
    if (!dueDate.startsWith(query.due.value)) return false;
  }
  // "none" und "pending" schraenken nicht ein (Plan Abschnitt 3).

  for (const term of query.textTerms) {
    if (!entry.haystack.includes(term)) return false;
  }

  return true;
}

// Ob 'task' zu 'col' gehoert -- dieselbe Regel wie app.tsx:80 und
// board-view.tsx:55/61: die virtuelle Sammelspalte sammelt Waisen, jede
// andere Spalte vergleicht per columnId.
function belongsToColumn(task: Task, col: Column, columns: Column[]): boolean {
  return col.id === ORPHAN_COLUMN_ID
    ? isOrphanTask(task, columns)
    : task.columnId === col.id;
}

// Treffer in Board-Reihenfolge: nach displayColumns, innerhalb der Spalte in
// der Reihenfolge von 'index' (das ist die Reihenfolge von 'tasks', mit der
// der Index gebaut wurde -- siehe board-view.tsx, das dieselbe Reihenfolge
// ueber tasks.filter() erreicht).
export function searchTasks(
  index: SearchEntry[],
  query: SearchQuery,
  displayColumns: Column[],
  columns: Column[],
): Task[] {
  const matched = index.filter((e) => matchesQuery(e, query)).map((e) => e.task);

  const result: Task[] = [];
  for (const col of displayColumns) {
    for (const task of matched) {
      if (belongsToColumn(task, col, columns)) {
        result.push(task);
      }
    }
  }
  return result;
}

// Spalte + Zeile des Tasks im Board. null, wenn er nicht (mehr) auf dem Board
// ist.
export function locateTask(
  taskId: string,
  tasks: Task[],
  displayColumns: Column[],
  columns: Column[],
): { col: number; row: number } | null {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return null;

  for (let colIdx = 0; colIdx < displayColumns.length; colIdx++) {
    const col = displayColumns[colIdx] as Column;
    if (!belongsToColumn(task, col, columns)) continue;

    const colTasks = tasks.filter((t) => belongsToColumn(t, col, columns));
    const row = colTasks.findIndex((t) => t.id === taskId);
    return { col: colIdx, row };
  }

  return null;
}
