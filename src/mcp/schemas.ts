// Geteilte Zod-Schema-Fragmente fuer MCP-Tools. Eigene Datei, damit
// tools.ts und tools-extras.ts sich das reportedBy-Schema teilen koennen,
// ohne dass die beiden sich gegenseitig importieren (tools.ts registriert
// bereits registerExtraTools aus tools-extras.ts -- ein Rueckimport waere
// zirkulaer).
import * as z from "zod/v4";

// P1-3: Pflichtfeld in allen vier schreibenden Tools, die eine Transition
// erzeugen (kanban_add_task, kanban_add_task_checked, kanban_move_task,
// kanban_complete_task) -- wortgleich, damit ein Agent dieselbe Frage
// unabhaengig vom Tool sieht. Bewusst z.string() statt z.enum(): die
// Rollenliste ist projektspezifisch und aendert sich, ein Enum wuerde ein
// fremdes Projekt mit anderen Rollen blockieren. Die Aufzaehlung der
// Rollennamen im Text ist der eigentliche Trick -- ein Agent, der nach einem
// freien String gefragt wird, schreibt "claude"; einer, der eine Liste sieht,
// waehlt daraus (ADR 0002, K-3).
export const reportedBySchema = z.string().describe(
  "Wer meldet diese Aenderung? Rollenname des aufrufenden Agents: " +
  "planer, backend, frontend, code-reviewer, teamlead, explorer. " +
  "Bei direkter Nutzung durch den Menschen: user."
);
