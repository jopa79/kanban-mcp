// Abhaengigkeits-Verwaltung: eigene Verantwortung, unabhaengig von der
// Zustandsmaschine (Refactoring-Task hs_Zn8_sXJia — task-service.ts war nach
// P2-1 auf 524 Zeilen gewachsen, 31% ueber der harten Grenze aus der globalen
// CLAUDE.md). Reine Verwaltung der 'dependencies'-Tabelle: anlegen, lesen,
// entfernen, sowie die daraus abgeleitete isBlocked-Abfrage.
//
// 'canMoveWhileBlocked' bleibt bewusst in TaskService, NICHT hier: das ist
// Regeldurchsetzung (Teil der Zustandsmaschine, ruft moveTask/completeTask
// auf), keine Datenhaltung -- die beiden Verantwortungen nicht vermischen.
//
// Abstract statt einer weiteren konkreten Zwischenklasse: addDependency()
// braucht getTask() zur Existenzpruefung UND um verkuerzte IDs auf die volle
// ID aufzuloesen (getTask unterstuetzt Prefix-Suche, dieselbe Semantik wie
// vorher) -- getTask() lebt aber in TaskService, einer Subklasse. Eine
// abstrakte Methode macht diese Abhaengigkeit fuer den Typchecker sichtbar,
// statt sich auf implizites Duck-Typing zwischen den Klassen zu verlassen.
import type { Task, TaskRow } from "./types.ts";
import { rowToTask } from "./types.ts";
import { ArchiveService } from "./archive-service.ts";

export abstract class DependencyService extends ArchiveService {
  // Wird von TaskService bereitgestellt (siehe Kommentar oben).
  abstract getTask(id: string): Task | null;

  // Abhaengigkeiten: Tasks die diesen Task blockieren
  getDependencies(taskId: string): Task[] {
    const rows = this.db
      .query(`SELECT t.* FROM tasks t JOIN dependencies d ON t.id = d.depends_on_id WHERE d.task_id = ?`)
      .all(taskId) as TaskRow[];
    return rows.map(rowToTask);
  }

  // Abhaengigkeiten: Tasks die von diesem Task abhaengen
  getDependents(taskId: string): Task[] {
    const rows = this.db
      .query(`SELECT t.* FROM tasks t JOIN dependencies d ON t.id = d.task_id WHERE d.depends_on_id = ?`)
      .all(taskId) as TaskRow[];
    return rows.map(rowToTask);
  }

  // Neue Abhaengigkeit anlegen
  addDependency(taskId: string, dependsOnId: string): void {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task '${taskId}' nicht gefunden`);
    const dep = this.getTask(dependsOnId);
    if (!dep) throw new Error(`Task '${dependsOnId}' nicht gefunden`);
    if (taskId === dep.id) throw new Error("Task kann nicht von sich selbst abhaengen");
    this.db.run(
      "INSERT OR IGNORE INTO dependencies (task_id, depends_on_id) VALUES (?, ?)",
      [task.id, dep.id],
    );
  }

  // Abhaengigkeit entfernen
  removeDependency(taskId: string, dependsOnId: string): void {
    this.db.run(
      "DELETE FROM dependencies WHERE task_id = ? AND depends_on_id = ?",
      [taskId, dependsOnId],
    );
  }

  // Pruefen ob Task blockiert ist (mind. eine Abhaengigkeit nicht in Terminal-Spalte)
  isBlocked(taskId: string): boolean {
    const terminal = this.boardService.getTerminalColumn();
    if (!terminal) return false;
    const deps = this.getDependencies(taskId);
    return deps.some(d => d.columnId !== terminal.id && !d.archived);
  }
}
