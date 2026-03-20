/**
 * ABOUTME: Build & Deploy Script fuer das Kanban MCP Tracker Plugin.
 * Bundled src/tracker.ts in eine Datei und kopiert sie nach
 * ~/.config/ralph-tui/plugins/trackers/kanban-mcp.ts
 */

import { mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PLUGIN_DIR = join(homedir(), '.config', 'ralph-tui', 'plugins', 'trackers');
const DIST_FILE = join(import.meta.dir, '..', 'dist', 'tracker.js');
const DEPLOY_FILE = join(PLUGIN_DIR, 'kanban-mcp.js');

async function main() {
  console.log('🔨 Building...');

  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, '..', 'src', 'tracker.ts')],
    outdir: join(import.meta.dir, '..', 'dist'),
    target: 'bun',
    format: 'esm',
  });

  if (!result.success) {
    console.error('❌ Build fehlgeschlagen:');
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  console.log('✅ Build erfolgreich: dist/tracker.js');

  // Deploy-Verzeichnis erstellen falls noetig
  await mkdir(PLUGIN_DIR, { recursive: true });

  // Gebundelte Datei kopieren
  await copyFile(DIST_FILE, DEPLOY_FILE);
  console.log(`✅ Deployed nach: ${DEPLOY_FILE}`);
}

main().catch((err) => {
  console.error('❌ Deploy fehlgeschlagen:', err);
  process.exit(1);
});
