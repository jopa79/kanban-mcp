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
