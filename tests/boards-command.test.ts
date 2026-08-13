// Tests fuer 'kanban boards' / 'boards add' / 'boards remove' (P3-1, zweite
// Haelfte). Wie registry-service.test.ts: kein Test darf die echte
// ~/.config/kanban/registry.json von JoPa beruehren -- jeder Test bekommt ein
// frisches, isoliertes Verzeichnis (Guard siehe unten).
import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RegistryService } from "../src/core/registry-service.ts";
import { getBoardPaths } from "../src/core/db.ts";
import { runBoardsList, defaultRegistryDir } from "../src/cli/board-overview.ts";
import { runBoardsAdd, runBoardsRemove } from "../src/cli/commands/boards.ts";
import { createTestBoard, addTaskInColumn, createLegacyV2Board } from "./helpers.ts";

function freshDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("kanban boards", () => {
  // --- Guard: echte Registry bleibt unangetastet (siehe registry-service.test.ts) ---
  function snapshotFile(path: string): string | null {
    return existsSync(path) ? readFileSync(path, "utf-8") : null;
  }

  let realRegistryPath: string;
  let realRegistryBefore: string | null;

  beforeAll(() => {
    realRegistryPath = join(defaultRegistryDir(), "registry.json");
    realRegistryBefore = snapshotFile(realRegistryPath);
  });

  afterAll(() => {
    expect(snapshotFile(realRegistryPath)).toBe(realRegistryBefore);
  });

  const cleanupFns: Array<() => void> = [];
  const dirsToClean: string[] = [];
  afterEach(() => {
    let fn: (() => void) | undefined;
    while ((fn = cleanupFns.pop())) fn();
    let dir: string | undefined;
    while ((dir = dirsToClean.pop())) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function freshRegistryDir(): string {
    const dir = freshDir("kanban-boards-registry-test-");
    dirsToClean.push(dir);
    return dir;
  }

  describe("runBoardsList", () => {
    test("leere Registry meldet sich freundlich statt zu scheitern", () => {
      const registryDir = freshRegistryDir();
      expect(() => runBoardsList(registryDir)).not.toThrow();
      expect(runBoardsList(registryDir)).toEqual([]);
    });

    test("mehrere gesunde Boards -- Namen und Task-Zahlen stimmen", () => {
      const registryDir = freshRegistryDir();
      const boardA = createTestBoard("Board A");
      const boardB = createTestBoard("Board B");
      cleanupFns.push(boardA.cleanup, boardB.cleanup);

      addTaskInColumn(boardA, "Task 1", "todo");
      addTaskInColumn(boardA, "Task 2", "todo");
      addTaskInColumn(boardB, "Task 3", "todo");

      const registry = new RegistryService(registryDir);
      registry.register(boardA.dir, "Board A");
      registry.register(boardB.dir, "Board B");

      const list = runBoardsList(registryDir);
      expect(list).toHaveLength(2);

      const a = list.find((e) => e.path === boardA.dir)!;
      const b = list.find((e) => e.path === boardB.dir)!;
      expect(a.status).toEqual({ kind: "ok", taskCount: 2 });
      expect(b.status).toEqual({ kind: "ok", taskCount: 1 });
    });

    test("Board mit Schema v2 wird markiert -- kein Absturz, andere Boards bleiben sichtbar", () => {
      const registryDir = freshRegistryDir();
      const healthy = createTestBoard("Gesund");
      const legacy = createLegacyV2Board({ boardName: "Alt" });
      cleanupFns.push(healthy.cleanup, legacy.cleanup);

      const registry = new RegistryService(registryDir);
      registry.register(healthy.dir, "Gesund");
      registry.register(legacy.dir, "Alt");

      let list: ReturnType<typeof runBoardsList> = [];
      expect(() => {
        list = runBoardsList(registryDir);
      }).not.toThrow();

      expect(list).toHaveLength(2);
      const legacyEntry = list.find((e) => e.path === legacy.dir)!;
      const healthyEntry = list.find((e) => e.path === healthy.dir)!;
      expect(legacyEntry.status).toEqual({ kind: "schema-outdated", version: 2 });
      expect(healthyEntry.status.kind).toBe("ok");
    });

    test("Board mit kaputter config.json wird markiert -- andere Boards bleiben sichtbar", () => {
      const registryDir = freshRegistryDir();
      const healthy = createTestBoard("Gesund");
      const broken = createTestBoard("Kaputt");
      cleanupFns.push(healthy.cleanup, broken.cleanup);

      // config.json nachtraeglich kaputt machen (kein gueltiges JSON).
      writeFileSync(getBoardPaths(broken.dir).configPath, "{ nicht: valides json");

      const registry = new RegistryService(registryDir);
      registry.register(healthy.dir, "Gesund");
      registry.register(broken.dir, "Kaputt");

      const list = runBoardsList(registryDir);
      expect(list).toHaveLength(2);

      const brokenEntry = list.find((e) => e.path === broken.dir)!;
      const healthyEntry = list.find((e) => e.path === healthy.dir)!;
      expect(brokenEntry.status.kind).toBe("error");
      expect(healthyEntry.status.kind).toBe("ok");
    });

    test("Pfad existiert nicht mehr -- missing, nicht aus der Registry entfernt", () => {
      const registryDir = freshRegistryDir();
      const ghostPath = join(registryDir, "ghost-board");
      const registry = new RegistryService(registryDir);
      registry.register(ghostPath, "Geist");

      const list = runBoardsList(registryDir);
      expect(list).toHaveLength(1);
      expect(list[0]!.status).toEqual({ kind: "missing" });

      // Nicht entfernt (RegistryService.list() roh geprueft, nicht ueber die Overview).
      expect(registry.list()).toHaveLength(1);
    });

    test("Ordner existiert noch, aber .kanban/board.db fehlt -- ebenfalls missing, kein neu angelegtes board.db", () => {
      const registryDir = freshRegistryDir();
      const projectDir = freshDir("kanban-boards-empty-dir-");
      dirsToClean.push(projectDir);

      const registry = new RegistryService(registryDir);
      registry.register(projectDir, "Kein Board");

      const list = runBoardsList(registryDir);
      expect(list[0]!.status).toEqual({ kind: "missing" });
      // Kein Schreibzugriff als Nebeneffekt des Listings.
      expect(existsSync(getBoardPaths(projectDir).dbPath)).toBe(false);
    });

    test("Name-Cache wird aus config.json aufgefrischt und persistiert", () => {
      const registryDir = freshRegistryDir();
      const board = createTestBoard("Alter Name");
      cleanupFns.push(board.cleanup);

      const registry = new RegistryService(registryDir);
      registry.register(board.dir, "Alter Name");

      // config.json extern geaendert (z.B. von Hand editiert).
      const configPath = getBoardPaths(board.dir).configPath;
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      config.name = "Neuer Name";
      writeFileSync(configPath, JSON.stringify(config));

      const list = runBoardsList(registryDir);
      expect(list[0]!.name).toBe("Neuer Name");

      // Persistiert, nicht nur im Rueckgabewert dieses einen Aufrufs.
      expect(registry.list()[0]!.name).toBe("Neuer Name");
    });
  });

  describe("runBoardsAdd", () => {
    test("registriert ein bestehendes Board, Name kommt aus config.json", () => {
      const registryDir = freshRegistryDir();
      const board = createTestBoard("Nachtraeglich");
      cleanupFns.push(board.cleanup);

      const result = runBoardsAdd(board.dir, registryDir);
      expect(result.name).toBe("Nachtraeglich");

      const list = new RegistryService(registryDir).list();
      expect(list).toHaveLength(1);
      expect(list[0]!.path).toBe(board.dir);
    });

    test("wirft einen verstaendlichen Fehler, wenn dort kein Board liegt", () => {
      const registryDir = freshRegistryDir();
      const emptyDir = freshDir("kanban-boards-no-board-");
      dirsToClean.push(emptyDir);

      expect(() => runBoardsAdd(emptyDir, registryDir)).toThrow(/Kein Board gefunden/);
    });

    test("faellt auf den Verzeichnisnamen zurueck, wenn config.json unlesbar ist", () => {
      const registryDir = freshRegistryDir();
      const legacy = createLegacyV2Board({ boardName: "Alt" });
      cleanupFns.push(legacy.cleanup);

      // v2-config.json hat kein 'columns'-Feld -- validateBoardConfig() lehnt sie ab.
      const result = runBoardsAdd(legacy.dir, registryDir);
      expect(result.name).toBe(legacy.dir.split("/").pop()!);
    });

    test("loest einen relativen Pfad zu einem absoluten auf", () => {
      const registryDir = freshRegistryDir();
      const board = createTestBoard("Relativ");
      cleanupFns.push(board.cleanup);

      const originalCwd = process.cwd();
      const parentDir = join(board.dir, "..");
      process.chdir(parentDir);
      try {
        const relative = board.dir.split("/").pop()!;
        const result = runBoardsAdd(relative, registryDir);
        // realpathSync noetig: macOS' tmpdir() liegt unter einem Symlink
        // (/tmp -> /private/tmp), process.cwd() nach chdir() liefert bereits
        // den aufgeloesten Pfad. Reine Testumgebungs-Eigenheit, kein
        // Produktionsverhalten -- resolve() in runBoardsAdd() bleibt bewusst
        // symlink-agnostisch (siehe runBoardsRemove-Test unten: ein
        // fehlender Pfad muss entfernbar bleiben, realpathSync() wuerfe dort).
        expect(result.path).toBe(realpathSync(board.dir));
      } finally {
        process.chdir(originalCwd);
      }
    });

    test("ohne Pfad-Argument: nutzt process.cwd()", () => {
      const registryDir = freshRegistryDir();
      const board = createTestBoard("CWD-Board");
      cleanupFns.push(board.cleanup);

      const originalCwd = process.cwd();
      process.chdir(board.dir);
      try {
        const result = runBoardsAdd(undefined, registryDir);
        expect(result.path).toBe(realpathSync(board.dir));
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe("runBoardsRemove", () => {
    test("entfernt einen registrierten Pfad", () => {
      const registryDir = freshRegistryDir();
      const registry = new RegistryService(registryDir);
      registry.register("/some/board/path", "my-board");

      const result = runBoardsRemove("/some/board/path", registryDir);
      expect(result.removed).toBe(true);
      expect(registry.list()).toHaveLength(0);
    });

    test("nicht registrierter Pfad: kein Fehler, removed = false", () => {
      const registryDir = freshRegistryDir();
      const result = runBoardsRemove("/unbekannt", registryDir);
      expect(result.removed).toBe(false);
    });

    test("loest einen relativen Pfad zu einem absoluten auf, bevor entfernt wird", () => {
      const registryDir = freshRegistryDir();
      const board = createTestBoard("Relativ-Remove");
      cleanupFns.push(board.cleanup);

      const registry = new RegistryService(registryDir);
      // realpathSync beim Registrieren, damit der Eintrag zur Aufloesung
      // unten passt (siehe Kommentar im Add-Test oben) -- in echten
      // Projektpfaden ohne Symlink-Zwischenschicht faellt das mit dem
      // rohen Pfad zusammen.
      registry.register(realpathSync(board.dir), "Relativ-Remove");

      const originalCwd = process.cwd();
      process.chdir(join(board.dir, ".."));
      try {
        const relative = board.dir.split("/").pop()!;
        const result = runBoardsRemove(relative, registryDir);
        expect(result.removed).toBe(true);
        expect(registry.list()).toHaveLength(0);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
