// Tests fuer RegistryService: Board-Registry unter <registryDir>/registry.json.
// WICHTIG: Kein Test in dieser Datei darf die echte ~/.kanban/registry.json von
// JoPa beruehren -- jeder Test bekommt ein frisches, isoliertes Verzeichnis.
import { test, expect, describe, beforeAll, afterAll, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import { RegistryService } from "../src/core/registry-service.ts";
import { initBoard } from "../src/core/db.ts";
import { runInit } from "../src/cli/commands/init.ts";
import { defaultRegistryDir } from "../src/cli/board-overview.ts";

function freshDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("RegistryService", () => {
  // --- Absicherung: echtes Home-Verzeichnis bleibt unangetastet ---
  // Dieser Guard ist bewusst kein simulierter Pfad, sondern prueft gegen den
  // tatsaechlichen Zustand auf dieser Maschine. Zwei Pfade werden bewacht:
  // der aktuelle Default (XDG-aware, i.d.R. ~/.config/kanban/registry.json)
  // UND der fruehere ~/.kanban/registry.json -- letzterer darf nach der
  // Umstellung auf ~/.config/kanban erst recht nicht mehr angelegt werden
  // (~/.kanban/ ist bei JoPa bereits ein echtes Board, kein Registry-Ort).
  function snapshotFile(path: string): string | null {
    return existsSync(path) ? readFileSync(path, "utf-8") : null;
  }

  const LEGACY_REAL_REGISTRY_PATH = join(homedir(), ".kanban", "registry.json");
  let realRegistryPath: string;
  let realRegistryBefore: string | null;
  let legacyRegistryBefore: string | null;

  beforeAll(() => {
    // Vor jeder Env-Manipulation durch Tests erfasst -- spiegelt den
    // tatsaechlichen Default in der echten Umgebung dieser Maschine.
    realRegistryPath = join(defaultRegistryDir(), "registry.json");
    realRegistryBefore = snapshotFile(realRegistryPath);
    legacyRegistryBefore = snapshotFile(LEGACY_REAL_REGISTRY_PATH);
  });

  afterAll(() => {
    expect(snapshotFile(realRegistryPath)).toBe(realRegistryBefore);
    expect(snapshotFile(LEGACY_REAL_REGISTRY_PATH)).toBe(legacyRegistryBefore);
  });

  const dirsToClean: string[] = [];
  afterEach(() => {
    let dir: string | undefined;
    while ((dir = dirsToClean.pop())) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function freshRegistryDir(): string {
    const dir = freshDir("kanban-registry-test-");
    dirsToClean.push(dir);
    return dir;
  }

  function freshProjectDir(): string {
    const dir = freshDir("kanban-project-test-");
    dirsToClean.push(dir);
    return dir;
  }

  describe("register", () => {
    test("registriert einen neuen Board-Pfad", () => {
      const registry = new RegistryService(freshRegistryDir());
      registry.register("/some/board/path", "my-board");

      const list = registry.list();
      expect(list).toHaveLength(1);
      expect(list[0]!.path).toBe("/some/board/path");
      expect(list[0]!.name).toBe("my-board");
      expect(list[0]!.registeredAt).toBeTruthy();
    });

    test("ist idempotent -- kein Duplikat bei zweiter Registrierung", () => {
      const registry = new RegistryService(freshRegistryDir());
      registry.register("/some/board/path", "my-board");
      registry.register("/some/board/path", "my-board");

      expect(registry.list()).toHaveLength(1);
    });

    test("frischt den Namen auf, behaelt aber registeredAt", () => {
      const registry = new RegistryService(freshRegistryDir());
      registry.register("/some/board/path", "old-name");
      const firstRegisteredAt = registry.list()[0]!.registeredAt;

      registry.register("/some/board/path", "new-name");
      const list = registry.list();

      expect(list).toHaveLength(1);
      expect(list[0]!.name).toBe("new-name");
      expect(list[0]!.registeredAt).toBe(firstRegisteredAt);
    });

    test("unterscheidet Boards anhand des Pfads, nicht des Namens", () => {
      const registry = new RegistryService(freshRegistryDir());
      registry.register("/path/a", "gleicher-name");
      registry.register("/path/b", "gleicher-name");

      expect(registry.list()).toHaveLength(2);
    });

    test("legt das Registry-Verzeichnis an, falls es fehlt", () => {
      const registryDir = freshRegistryDir();
      rmSync(registryDir, { recursive: true, force: true });
      expect(existsSync(registryDir)).toBe(false);

      const registry = new RegistryService(registryDir);
      registry.register("/some/board/path", "my-board");

      expect(existsSync(registryDir)).toBe(true);
      expect(registry.list()).toHaveLength(1);
    });

    test("schreibt atomar -- keine tmp-Datei bleibt zurueck", () => {
      const registryDir = freshRegistryDir();
      const registry = new RegistryService(registryDir);
      registry.register("/some/board/path", "my-board");

      expect(readdirSync(registryDir)).toEqual(["registry.json"]);
    });
  });

  describe("remove", () => {
    test("entfernt einen registrierten Pfad", () => {
      const registry = new RegistryService(freshRegistryDir());
      registry.register("/some/board/path", "my-board");
      registry.remove("/some/board/path");

      expect(registry.list()).toHaveLength(0);
    });

    test("wirft keinen Fehler bei nicht registriertem Pfad", () => {
      const registry = new RegistryService(freshRegistryDir());
      expect(() => registry.remove("/unbekannt")).not.toThrow();
    });
  });

  describe("list", () => {
    test("leere Registry meldet sich freundlich statt zu scheitern", () => {
      const registry = new RegistryService(freshRegistryDir());
      expect(() => registry.list()).not.toThrow();
      expect(registry.list()).toEqual([]);
    });

    test("fehlender Pfad wird als missing markiert, nicht entfernt", () => {
      const registryDir = freshRegistryDir();
      const ghostPath = join(registryDir, "ghost-board");
      const registry = new RegistryService(registryDir);
      registry.register(ghostPath, "ghost");

      const list = registry.list();
      expect(list).toHaveLength(1);
      expect(list[0]!.missing).toBe(true);
    });

    test("existierender Pfad wird nicht als missing markiert", () => {
      const registryDir = freshRegistryDir();
      const projectDir = freshProjectDir();
      const registry = new RegistryService(registryDir);
      registry.register(projectDir, "real-board");

      expect(registry.list()[0]!.missing).toBe(false);
    });
  });

  describe("Abgrenzung zu initBoard()", () => {
    test("initBoard() allein erzeugt keinen Registry-Eintrag", () => {
      const projectDir = freshProjectDir();
      const registryDir = freshRegistryDir();

      // initBoard kennt keine Registry -- der Aufruf hat keinerlei Wirkung auf
      // sie. (tests/helpers.ts:createTestBoard ruft genau das bei jedem
      // Testlauf auf -- wuerde initBoard registrieren, waere die Registry nach
      // einer Woche Entwicklung voller toter /var/folders/...-Pfade.)
      initBoard(projectDir, "Testboard");

      expect(new RegistryService(registryDir).list()).toHaveLength(0);
    });
  });

  describe("CLI-Anbindung (kanban init)", () => {
    describe("defaultRegistryDir", () => {
      const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;

      afterEach(() => {
        if (originalXdgConfigHome === undefined) {
          delete process.env.XDG_CONFIG_HOME;
        } else {
          process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
        }
      });

      test("nutzt ~/.config/kanban wenn XDG_CONFIG_HOME nicht gesetzt ist", () => {
        delete process.env.XDG_CONFIG_HOME;
        expect(defaultRegistryDir()).toBe(join(homedir(), ".config", "kanban"));
      });

      test("nutzt ~/.config/kanban wenn XDG_CONFIG_HOME leer ist", () => {
        process.env.XDG_CONFIG_HOME = "";
        expect(defaultRegistryDir()).toBe(join(homedir(), ".config", "kanban"));
      });

      test("respektiert XDG_CONFIG_HOME wenn gesetzt", () => {
        process.env.XDG_CONFIG_HOME = "/custom/xdg/config";
        expect(defaultRegistryDir()).toBe(join("/custom/xdg/config", "kanban"));
      });

      // Laut XDG-Spec ist ein relativer Wert ungueltig und zaehlt als nicht
      // gesetzt. Ohne diese Pruefung landet die Registry relativ zum cwd --
      // je nach Aufrufort also in einer anderen Datei.
      test("ignoriert XDG_CONFIG_HOME wenn der Pfad relativ ist", () => {
        process.env.XDG_CONFIG_HOME = "tmp";
        expect(defaultRegistryDir()).toBe(join(homedir(), ".config", "kanban"));
      });

      test("liefert immer einen absoluten Pfad", () => {
        process.env.XDG_CONFIG_HOME = "relativ/pfad";
        expect(isAbsolute(defaultRegistryDir())).toBe(true);
      });
    });

    test("kanban init registriert das Board standardmaessig", () => {
      const projectDir = freshProjectDir();
      const registryDir = freshRegistryDir();

      runInit(projectDir, "Test", { register: true, registryDir });

      const list = new RegistryService(registryDir).list();
      expect(list).toHaveLength(1);
      expect(list[0]!.path).toBe(projectDir);
      expect(list[0]!.name).toBe("Test");
    });

    test("kanban init --no-register registriert nicht", () => {
      const projectDir = freshProjectDir();
      const registryDir = freshRegistryDir();

      runInit(projectDir, "Test", { register: false, registryDir });

      expect(new RegistryService(registryDir).list()).toHaveLength(0);
    });
  });
});
