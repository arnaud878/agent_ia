/**
 * Exécute un fichier SQL avec psql en utilisant DATABASE_URL depuis .env (répertoire ia_back).
 * Usage : node scripts/db-exec.cjs <fichier.sql>
 */
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
});

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/db-exec.cjs <fichier.sql>');
  process.exit(1);
}
const abs = path.isAbsolute(file) ? file : path.join(__dirname, '..', file);
if (!fs.existsSync(abs)) {
  console.error('Fichier introuvable:', abs);
  process.exit(1);
}

const url = process.env.DATABASE_URL;
if (!url || String(url).trim() === '') {
  console.error('DATABASE_URL manquant dans .env');
  process.exit(1);
}

const r = spawnSync(
  'psql',
  [url, '-v', 'ON_ERROR_STOP=1', '-f', abs],
  { stdio: 'inherit', shell: false },
);
process.exit(r.status === 0 ? 0 : r.status ?? 1);
