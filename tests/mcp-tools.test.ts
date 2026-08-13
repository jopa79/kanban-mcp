// Tests fuer die MCP-Werkzeugoberflaeche (P1-3/P1-4): reportedBy als
// Pflichtfeld in den vier schreibenden Tools, Ablehnungen mit isError: true,
// kein "force"-Hinweis bei kanban_add_task_checked. Echter Client/Server-
// Roundtrip ueber InMemoryTransport -- so sieht ein Agent die Antworten
// tatsaechlich (Siehe ADR 0002, Kanban P1-3 #19 / P1-4 #20).
import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { registerTools } from "../src/mcp/tools.ts";
import { initBoard, openDb, getBoardPaths, loadBoardConfig } from "../src/core/db.ts";
import { BoardService } from "../src/core/board-service.ts";
import { TransitionService } from "../src/core/transition-service.ts";

interface McpTestContext {
  dir: string;
  client: Client;
  cleanup: () => Promise<void>;
}

// Baut einen echten, lokal verbundenen MCP-Client gegen ein frisches
// Test-Board -- keine Mocks, derselbe Registrierungscode wie im echten Server
// (src/mcp/server.ts), nur mit InMemoryTransport statt Stdio.
async function createMcpTestClient(name = "Test Board"): Promise<McpTestContext> {
  const dir = mkdtempSync(join(tmpdir(), "kanban-mcp-test-"));
  initBoard(dir, name);

  const server = new McpServer({ name: "kanban-mcp-test", version: "0.1.0" }, { capabilities: { tools: {} } });
  registerTools(server, dir);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.1.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const cleanup = async () => {
    await client.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  };

  return { dir, client, cleanup };
}

// Extrahiert den Text aus einer Tool-Antwort (content[0].text) -- so, wie ein
// Agent den Content-Block liest.
function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content[0]?.text ?? "";
}

// Liest die Transition-Historie eines Tasks direkt aus der Test-DB -- fuer
// Assertions, die pruefen wollen, was tatsaechlich in transitions.reported_by
// gelandet ist (die Tool-Antwort selbst zeigt das nicht).
function readHistory(dir: string, taskId: string) {
  const paths = getBoardPaths(dir);
  const db = openDb(paths.dbPath);
  const config = loadBoardConfig(paths.configPath);
  const boardService = new BoardService(db, config);
  const transitions = new TransitionService(db, boardService);
  const history = transitions.history(taskId);
  db.close();
  return history;
}

function extractTaskId(text: string): string {
  const match = text.match(/ID: ([^)]+)\)/);
  if (!match) throw new Error(`Keine Task-ID in Antwort gefunden: ${text}`);
  return match[1]!;
}

describe("MCP-Tools — reportedBy-Pflichtfeld (P1-3)", () => {
  let ctx: McpTestContext;
  afterEach(async () => ctx?.cleanup());

  test("kanban_add_task ohne reportedBy -> isError: true, verstaendlicher Text", async () => {
    ctx = await createMcpTestClient();
    const result = await ctx.client.callTool({ name: "kanban_add_task", arguments: { title: "X" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("reportedBy");
  });

  test("kanban_add_task mit reportedBy -> Wert landet in transitions.reported_by", async () => {
    ctx = await createMcpTestClient();
    const result = await ctx.client.callTool({
      name: "kanban_add_task",
      arguments: { title: "X", reportedBy: "backend" },
    });
    expect(result.isError).toBeUndefined();
    const taskId = extractTaskId(textOf(result));
    const history = readHistory(ctx.dir, taskId);
    expect(history[0]!.reportedBy).toBe("backend");
  });

  test("kanban_move_task ohne reportedBy -> isError: true", async () => {
    ctx = await createMcpTestClient();
    const created = await ctx.client.callTool({
      name: "kanban_add_task",
      arguments: { title: "X", reportedBy: "backend" },
    });
    const taskId = extractTaskId(textOf(created));

    const result = await ctx.client.callTool({
      name: "kanban_move_task",
      arguments: { id: taskId, columnId: "in-progress" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("reportedBy");
  });

  test("kanban_move_task mit reportedBy -> Wert landet in transitions.reported_by", async () => {
    ctx = await createMcpTestClient();
    const created = await ctx.client.callTool({
      name: "kanban_add_task",
      arguments: { title: "X", reportedBy: "backend" },
    });
    const taskId = extractTaskId(textOf(created));

    await ctx.client.callTool({
      name: "kanban_move_task",
      arguments: { id: taskId, columnId: "in-progress", reportedBy: "planer" },
    });
    const history = readHistory(ctx.dir, taskId);
    expect(history[history.length - 1]!.reportedBy).toBe("planer");
  });

  test("kanban_complete_task ohne reportedBy -> isError: true", async () => {
    ctx = await createMcpTestClient();
    const created = await ctx.client.callTool({
      name: "kanban_add_task",
      arguments: { title: "X", reportedBy: "backend" },
    });
    const taskId = extractTaskId(textOf(created));

    const result = await ctx.client.callTool({ name: "kanban_complete_task", arguments: { id: taskId } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("reportedBy");
  });

  test("kanban_add_task_checked ohne reportedBy -> isError: true", async () => {
    ctx = await createMcpTestClient();
    const result = await ctx.client.callTool({ name: "kanban_add_task_checked", arguments: { title: "X" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("reportedBy");
  });

  test("kanban_update_task und kanban_delete_task funktionieren weiterhin OHNE reportedBy", async () => {
    // K-3: reportedBy gilt nur fuer Transitions -- diese beiden Tools loesen
    // keine aus und duerfen NICHT ploetzlich reportedBy verlangen.
    ctx = await createMcpTestClient();
    const created = await ctx.client.callTool({
      name: "kanban_add_task",
      arguments: { title: "X", reportedBy: "backend" },
    });
    const taskId = extractTaskId(textOf(created));

    const updated = await ctx.client.callTool({
      name: "kanban_update_task",
      arguments: { id: taskId, title: "Y" },
    });
    expect(updated.isError).toBeUndefined();

    const deleted = await ctx.client.callTool({ name: "kanban_delete_task", arguments: { id: taskId } });
    expect(deleted.isError).toBeUndefined();
  });
});

describe("MCP-Tools — Ablehnungen mit isError (P1-4)", () => {
  let ctx: McpTestContext;
  afterEach(async () => ctx?.cleanup());

  test("kanban_move_task: Kettenverstoss (todo -> review) -> isError: true, nennt in-progress als naechsten Schritt", async () => {
    ctx = await createMcpTestClient();
    const created = await ctx.client.callTool({
      name: "kanban_add_task",
      arguments: { title: "X", reportedBy: "backend" },
    });
    const taskId = extractTaskId(textOf(created));

    const result = await ctx.client.callTool({
      name: "kanban_move_task",
      arguments: { id: taskId, columnId: "review", reportedBy: "backend" },
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("in-progress");
    expect(text).toContain("Kette");
  });

  test("kanban_complete_task auf Task in In Progress -> isError: true", async () => {
    ctx = await createMcpTestClient();
    const created = await ctx.client.callTool({
      name: "kanban_add_task",
      arguments: { title: "X", reportedBy: "backend" },
    });
    const taskId = extractTaskId(textOf(created));
    await ctx.client.callTool({
      name: "kanban_move_task",
      arguments: { id: taskId, columnId: "in-progress", reportedBy: "backend" },
    });

    const result = await ctx.client.callTool({
      name: "kanban_complete_task",
      arguments: { id: taskId, reportedBy: "backend" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Review");
  });

  test("kanban_add_task mit columnId: 'done' -> isError: true", async () => {
    ctx = await createMcpTestClient();
    const result = await ctx.client.callTool({
      name: "kanban_add_task",
      arguments: { title: "X", columnId: "done", reportedBy: "backend" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Eintrittsspalte");
  });

  test("Ablehnungstext kommt vollstaendig an, nicht auf eine Zeile gekuerzt", async () => {
    ctx = await createMcpTestClient();
    const created = await ctx.client.callTool({
      name: "kanban_add_task",
      arguments: { title: "Mehrzeiliger Test", reportedBy: "backend" },
    });
    const taskId = extractTaskId(textOf(created));

    const result = await ctx.client.callTool({
      name: "kanban_move_task",
      arguments: { id: taskId, columnId: "review", reportedBy: "backend" },
    });
    const text = textOf(result);
    // Der volle, mehrzeilige Kettenablehnungstext aus TransitionService muss
    // unverkuerzt ankommen (Task, Quelle, Ziel, naechster Schritt).
    expect(text).toContain("Mehrzeiliger Test");
    expect(text.split("\n").length).toBeGreaterThan(3);
  });
});

describe("MCP-Tools — kanban_add_task_checked entschaerft (P1-4)", () => {
  let ctx: McpTestContext;
  afterEach(async () => ctx?.cleanup());

  test("aehnlicher Titel -> isError: true, Antwort enthaelt IDs, 'force' kommt nirgends vor", async () => {
    ctx = await createMcpTestClient();
    await ctx.client.callTool({
      name: "kanban_add_task",
      arguments: { title: "Login Feature bauen", reportedBy: "backend" },
    });

    const result = await ctx.client.callTool({
      name: "kanban_add_task_checked",
      arguments: { title: "Login Feature implementieren", reportedBy: "backend" },
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text.toLowerCase()).not.toContain("force");
    expect(text).toContain("Login Feature bauen");
    // Eine ID (8-stelliges Praefix in eckigen Klammern) muss enthalten sein,
    // sonst kann der Agent den bestehenden Task nicht oeffnen.
    expect(text).toMatch(/\[[A-Za-z0-9_-]{8}\]/);
  });

  test("force=true umgeht die Ablehnung weiterhin (Parameter bleibt im Schema)", async () => {
    ctx = await createMcpTestClient();
    await ctx.client.callTool({
      name: "kanban_add_task",
      arguments: { title: "Login Feature", reportedBy: "backend" },
    });

    const result = await ctx.client.callTool({
      name: "kanban_add_task_checked",
      arguments: { title: "Login Feature", reportedBy: "backend", force: true },
    });
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain("Task erstellt");
  });

  test("Tool-Beschreibung wirbt nirgends mehr fuer force", async () => {
    ctx = await createMcpTestClient();
    const tools = await ctx.client.listTools();
    const tool = tools.tools.find((t) => t.name === "kanban_add_task_checked");
    expect(tool).toBeDefined();
    expect(tool!.description?.toLowerCase() ?? "").not.toContain("force");

    const forceProp = (tool!.inputSchema as { properties?: Record<string, { description?: string }> })
      .properties?.force;
    // Der Parameter existiert weiterhin im Schema (fehlbare Heuristik, ein
    // Override ist legitim) -- aber ohne werbendes .describe().
    expect(forceProp).toBeDefined();
    expect(forceProp?.description ?? "").toBe("");
  });
});

describe("MCP-Tools — priority/dueDate (P2-1/P2-2)", () => {
  let ctx: McpTestContext;
  afterEach(async () => ctx?.cleanup());

  test("kanban_add_task mit priority/dueDate -> kanban_get_task zeigt beides plus isOverdue", async () => {
    ctx = await createMcpTestClient();
    const created = await ctx.client.callTool({
      name: "kanban_add_task",
      arguments: { title: "X", reportedBy: "backend", priority: "high", dueDate: "2000-01-01" },
    });
    const taskId = extractTaskId(textOf(created));

    const result = await ctx.client.callTool({ name: "kanban_get_task", arguments: { id: taskId } });
    const enriched = JSON.parse(textOf(result));
    expect(enriched.priority).toBe("high");
    expect(enriched.dueDate).toBe("2000-01-01");
    // Faellig im Jahr 2000 -- unabhaengig vom aktuellen Datum sicher ueberfaellig.
    expect(enriched.isOverdue).toBe(true);
  });

  test("kanban_add_task mit ungueltiger priority -> isError: true, nennt die drei gueltigen Werte", async () => {
    ctx = await createMcpTestClient();
    const result = await ctx.client.callTool({
      name: "kanban_add_task",
      arguments: { title: "X", reportedBy: "backend", priority: "urgent" },
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("high");
    expect(text).toContain("medium");
    expect(text).toContain("low");
  });

  test("kanban_add_task mit ungueltigem dueDate (Kalendertag existiert nicht) -> isError: true", async () => {
    ctx = await createMcpTestClient();
    const result = await ctx.client.callTool({
      name: "kanban_add_task",
      arguments: { title: "X", reportedBy: "backend", dueDate: "2026-02-31" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("existiert im Kalender nicht");
  });

  test("kanban_add_task mit falschem Datumsformat -> isError: true, nennt das erwartete Format", async () => {
    ctx = await createMcpTestClient();
    const result = await ctx.client.callTool({
      name: "kanban_add_task",
      arguments: { title: "X", reportedBy: "backend", dueDate: "01.03.2026" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("YYYY-MM-DD");
  });

  test("kanban_update_task mit priority: null setzt die Prioritaet zurueck", async () => {
    ctx = await createMcpTestClient();
    const created = await ctx.client.callTool({
      name: "kanban_add_task",
      arguments: { title: "X", reportedBy: "backend", priority: "low" },
    });
    const taskId = extractTaskId(textOf(created));

    await ctx.client.callTool({
      name: "kanban_update_task",
      arguments: { id: taskId, priority: null },
    });

    const result = await ctx.client.callTool({ name: "kanban_get_task", arguments: { id: taskId } });
    expect(JSON.parse(textOf(result)).priority).toBeNull();
  });

  test("kanban_list_tasks mit priority-Filter", async () => {
    ctx = await createMcpTestClient();
    await ctx.client.callTool({ name: "kanban_add_task", arguments: { title: "A", reportedBy: "x", priority: "high" } });
    await ctx.client.callTool({ name: "kanban_add_task", arguments: { title: "B", reportedBy: "x", priority: "low" } });

    const result = await ctx.client.callTool({ name: "kanban_list_tasks", arguments: { priority: "high" } });
    const tasks = JSON.parse(textOf(result));
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe("A");
  });

  test("kanban_list_tasks mit overdue: true liefert nur ueberfaellige Tasks", async () => {
    ctx = await createMcpTestClient();
    await ctx.client.callTool({ name: "kanban_add_task", arguments: { title: "Ueberfaellig", reportedBy: "x", dueDate: "2000-01-01" } });
    await ctx.client.callTool({ name: "kanban_add_task", arguments: { title: "Zukunft", reportedBy: "x", dueDate: "2999-01-01" } });

    const result = await ctx.client.callTool({ name: "kanban_list_tasks", arguments: { overdue: true } });
    const tasks = JSON.parse(textOf(result));
    expect(tasks.map((t: { title: string }) => t.title)).toEqual(["Ueberfaellig"]);
  });

  test("kanban_add_task_checked akzeptiert priority/dueDate ebenfalls", async () => {
    ctx = await createMcpTestClient();
    const result = await ctx.client.callTool({
      name: "kanban_add_task_checked",
      arguments: { title: "X", reportedBy: "backend", priority: "medium", dueDate: "2026-08-01" },
    });
    expect(result.isError).toBeUndefined();
    const taskId = extractTaskId(textOf(result));

    const getResult = await ctx.client.callTool({ name: "kanban_get_task", arguments: { id: taskId } });
    const enriched = JSON.parse(textOf(getResult));
    expect(enriched.priority).toBe("medium");
    expect(enriched.dueDate).toBe("2026-08-01");
  });
});

// GitHub #44: TaskService.reorderTask existierte seit P2-3 und wurde von der
// TUI genutzt, war aber nie als MCP-Tool exponiert. Agents konnten die
// Reihenfolge im Todo nur ueber einen Self-Move ueber kanban_move_task
// beeinflussen -- der unechte Transitionen schrieb (siehe #45).
describe("MCP-Tools — kanban_reorder_task (#44)", () => {
  let ctx: McpTestContext;
  afterEach(() => ctx?.cleanup());

  // Legt zwei Tasks im Todo an und gibt sie in Anlagereihenfolge zurueck.
  async function addTwo(): Promise<[string, string]> {
    const ids: string[] = [];
    for (const title of ["Erster", "Zweiter"]) {
      const res = await ctx.client.callTool({
        name: "kanban_add_task",
        arguments: { title, reportedBy: "teamlead" },
      });
      ids.push(extractTaskId(textOf(res)));
    }
    return [ids[0]!, ids[1]!];
  }

  async function positionOf(id: string): Promise<number> {
    const res = await ctx.client.callTool({ name: "kanban_get_task", arguments: { id } });
    return JSON.parse(textOf(res)).position;
  }

  test("das Tool ist registriert", async () => {
    ctx = await createMcpTestClient();
    const { tools } = await ctx.client.listTools();
    expect(tools.map((t) => t.name)).toContain("kanban_reorder_task");
  });

  test("direction: up tauscht den Task mit seinem Vorgaenger", async () => {
    ctx = await createMcpTestClient();
    const [first, second] = await addTwo();

    const result = await ctx.client.callTool({
      name: "kanban_reorder_task",
      arguments: { id: second, direction: "up" },
    });

    expect(result.isError).toBeUndefined();
    expect(await positionOf(second)).toBeLessThan(await positionOf(first));
  });

  test("direction: down tauscht den Task mit seinem Nachfolger", async () => {
    ctx = await createMcpTestClient();
    const [first, second] = await addTwo();

    await ctx.client.callTool({ name: "kanban_reorder_task", arguments: { id: first, direction: "down" } });

    expect(await positionOf(first)).toBeGreaterThan(await positionOf(second));
  });

  test("schreibt keine Transition — ein Reorder ist kein Spaltenwechsel", async () => {
    ctx = await createMcpTestClient();
    const [first, second] = await addTwo();
    const before = readHistory(ctx.dir, second).length;

    await ctx.client.callTool({ name: "kanban_reorder_task", arguments: { id: second, direction: "up" } });

    expect(readHistory(ctx.dir, second)).toHaveLength(before);
    expect(readHistory(ctx.dir, first)).toHaveLength(1);
  });

  test("ohne Nachbar in der Richtung: No-Op statt Fehler", async () => {
    ctx = await createMcpTestClient();
    const [first] = await addTwo();

    const result = await ctx.client.callTool({
      name: "kanban_reorder_task",
      arguments: { id: first, direction: "up" },
    });

    expect(result.isError).toBeUndefined();
    expect(await positionOf(first)).toBe(0);
  });

  test("unbekannte Task-ID meldet einen Fehler statt still zu scheitern", async () => {
    ctx = await createMcpTestClient();
    const result = await ctx.client.callTool({
      name: "kanban_reorder_task",
      arguments: { id: "gibt-es-nicht", direction: "up" },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/nicht gefunden/);
  });

  test("ungueltige direction wird vom Schema abgelehnt", async () => {
    ctx = await createMcpTestClient();
    const [first] = await addTwo();
    const result = await ctx.client.callTool({
      name: "kanban_reorder_task",
      arguments: { id: first, direction: "seitwaerts" },
    });

    expect(result.isError).toBe(true);
  });
});
