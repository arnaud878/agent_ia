import { Parser } from 'node-sql-parser';
import type { DbType } from '../db/db-adapter';

const parser = new Parser();

function parserDialect(dbType: DbType): string {
  if (dbType === 'mysql') {
    return 'MySQL';
  }
  if (dbType === 'mssql') {
    return 'Transactsql';
  }
  return 'Postgresql';
}

/**
 * Vérifie que toutes les tables visitées par le SELECT sont dans `allowed`.
 */
export function assertSelectSqlUsesOnlyAllowedTables(
  sql: string,
  allowed: Set<string>,
  dbType: DbType = 'postgresql',
): void {
  let list: string[];
  try {
    list = parser.tableList(sql, { database: parserDialect(dbType) });
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
