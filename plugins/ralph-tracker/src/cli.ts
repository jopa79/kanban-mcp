/**
 * ABOUTME: CLI Wrapper fuer Kanban MCP Befehle.
 * Fuehrt Kanban-Kommandos via Bun.spawn aus und parst JSON-Ausgaben.
 * Jede Funktion gibt bei Fehlern einen sicheren Default zurueck (null, [], false).
 */

import type { PluginConfig, KanbanTask, KanbanStatus, CliResult } from './types';

/** Timeout fuer CLI-Aufrufe: 10 Sekunden */
const CLI_TIMEOUT_MS = 10_000;

/**
 * Fuehrt einen Kanban CLI Befehl aus und gibt stdout/stderr/exitCode zurueck.
 * Gemeinsame Bun.spawn-Logik fuer alle CLI-Funktionen.
 */
export async function execKanban(config: PluginConfig, args: string[]): Promise<CliResult> {
  try {
    const proc = Bun.spawn([config.kanbanBin, ...args], {
      cwd: config.projectDir,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env },
    });

    // Timeout-Handling
    const timeout = setTimeout(() => {
      proc.kill();
    }, CLI_TIMEOUT_MS);

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;
    clearTimeout(timeout);

    return { stdout, stderr, exitCode };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: '', stderr: message, exitCode: 1 };
  }
}

/**
 * Listet Tasks auf. Optional gefiltert nach Spalte.
 * Gibt bei Fehlern ein leeres Array zurueck.
 */
export async function kanbanList(config: PluginConfig, columnId?: string): Promise<KanbanTask[]> {
  const args = ['list', '--json'];
  if (columnId) {
    args.push('--column', columnId);
  }

  const result = await execKanban(config, args);

  if (result.exitCode !== 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(result.stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Holt einen einzelnen Task per ID.
 * Gibt null zurueck wenn der Task nicht gefunden wird oder ein Fehler auftritt.
 */
export async function kanbanGet(config: PluginConfig, taskId: string): Promise<KanbanTask | null> {
  const result = await execKanban(config, ['get', taskId, '--json']);

  if (result.exitCode !== 0) {
    return null;
  }

  try {
    return JSON.parse(result.stdout) as KanbanTask;
  } catch {
    return null;
  }
}

/**
 * Verschiebt einen Task in eine andere Spalte.
 * Gibt true bei Erfolg, false bei Fehler zurueck.
 */
export async function kanbanMove(config: PluginConfig, taskId: string, columnId: string): Promise<boolean> {
  const result = await execKanban(config, ['move', taskId, columnId]);
  return result.exitCode === 0;
}

/**
 * Ruft den Board-Status ab (Spalten-Uebersicht, Gesamtzahl Tasks).
 * Gibt null bei Fehler zurueck.
 */
export async function kanbanStatus(config: PluginConfig): Promise<KanbanStatus | null> {
  const result = await execKanban(config, ['status', '--json']);

  if (result.exitCode !== 0) {
    return null;
  }

  try {
    return JSON.parse(result.stdout) as KanbanStatus;
  } catch {
    return null;
  }
}
