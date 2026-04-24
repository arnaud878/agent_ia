import { Parser } from 'node-sql-parser';

const parser = new Parser();

/**
 * Vérifie que toutes les tables visitées par le SELECT sont dans `allowed`.
 * Basé sur `node-sql-parser` (PostgreSQL).
 */
export function assertSelectSqlUsesOnlyAllowedTables(
  sql: string,
  allowed: Set<string>,
): void {
  let list: string[];
  try {
    list = parser.tableList(sql, { database: 'Postgresql' });
  } catch {
    throw new Error('Requête SQL non analysable (syntaxe ou dialecte).');
  }
  for (const entry of list) {
    const parts = entry.split('::');
    const name = parts[parts.length - 1];
    if (!name) {
      continue;
    }
    if (!allowed.has(name)) {
      throw new Error(
        `Accès refusé à la table « ${name} » (hors périmètre du rôle).`,
      );
    }
  }
}
