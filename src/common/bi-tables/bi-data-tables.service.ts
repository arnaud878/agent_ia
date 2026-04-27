import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_BI_DATA_TABLES } from '../constants/bi-data-tables';

const LOG = new Logger('BiDataTablesService');
const RE_SAFE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Registre des tables d’analyse BI (allowlist) : lu depuis
 * `BI_DATA_TABLES_CONFIG` (défaut : `config/bi-data-tables.json` sous le cwd).
 */
@Injectable()
export class BiDataTablesService {
  private readonly tableNames: readonly string[];

  constructor(private readonly config: ConfigService) {
    const loaded = this.load();
    this.tableNames = Object.freeze(
      loaded.length > 0 ? loaded : [...DEFAULT_BI_DATA_TABLES],
    ) as readonly string[];
  }

  getAllTableNames(): readonly string[] {
    return this.tableNames;
  }

  isBiDataTableName(name: string): boolean {
    return this.tableNames.includes(name);
  }

  private load(): string[] {
    const def = [...DEFAULT_BI_DATA_TABLES];
    const rel = (
      this.config.get<string>('BI_DATA_TABLES_CONFIG') ?? 'config/bi-data-tables.json'
    ).trim();
    const full = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
    if (!fs.existsSync(full)) {
      return def;
    }
    try {
      const raw = fs.readFileSync(full, 'utf8');
      const j = JSON.parse(raw) as { tables?: unknown };
      if (!j || !Array.isArray(j.tables) || j.tables.length === 0) {
        LOG.warn(
          'Fichier %s : propriété "tables" absente ou vide — fallback aux tables par défaut',
          full,
        );
        return def;
      }
      const out = j.tables
        .map((x) => String(x).trim())
        .filter((x) => RE_SAFE_NAME.test(x));
      if (out.length === 0) {
        LOG.warn('Aucun nom de table valide dans %s — fallback par défaut', full);
        return def;
      }
      return out;
    } catch (e) {
      LOG.warn(
        'Lecture %s échouée (%s) — fallback aux tables par défaut',
        full,
        (e as Error).message,
      );
      return def;
    }
  }
}
