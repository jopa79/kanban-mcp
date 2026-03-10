// Notes-Service: Markdown-Dateien fuer Tasks verwalten
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export class NotesService {
  private notesDir: string;

  constructor(kanbanDir: string) {
    this.notesDir = join(kanbanDir, "notes");
  }

  // Pfad zur Notes-Datei
  getPath(taskId: string): string {
    return join(this.notesDir, `${taskId}.md`);
  }

  // Pruefen ob Notes existieren
  exists(taskId: string): boolean {
    return existsSync(this.getPath(taskId));
  }

  // Notes laden (null wenn keine vorhanden)
  load(taskId: string): string | null {
    const path = this.getPath(taskId);
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf-8");
  }

  // Notes speichern (erstellt notes/ Ordner automatisch)
  save(taskId: string, content: string): void {
    if (!existsSync(this.notesDir)) {
      mkdirSync(this.notesDir, { recursive: true });
    }
    writeFileSync(this.getPath(taskId), content, "utf-8");
  }

  // Notes loeschen
  delete(taskId: string): void {
    const path = this.getPath(taskId);
    if (existsSync(path)) {
      unlinkSync(path);
    }
  }
}
