import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';

/**
 * Charge `.env` / `.env.local` avant toute autre importation d’appli, pour que
 * `N8N_WEBHOOK_PATH_SEGMENT` et le reste soient dispo pour les `@Post()` (résolues à l’import).
 */
const root = process.cwd();
for (const name of ['.env', '.env.local']) {
  const p = join(root, name);
  if (existsSync(p)) {
    config({ path: p, override: name === '.env.local' });
  }
}
