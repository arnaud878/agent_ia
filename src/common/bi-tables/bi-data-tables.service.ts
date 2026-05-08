import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DEFAULT_BI_DATA_TABLES } from '../constants/bi-data-tables';

const LOG = new Logger('BiDataTablesService');
const RE_SAFE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Registre des tables d’analyse BI (allowlist) : stocké en base
 * dans `public.bi_allowed_tables`.
 */
@Injectable()
export class BiDataTablesService implements OnModuleInit, OnModuleDestroy {
  private readonly appPool: Pool;
  private tableNames: readonly string[] = Object.freeze([...DEFAULT_BI_DATA_TABLES]);

  constructor(private readonly config: ConfigService) {
    const appUrl = this.config.getOrThrow<string>('DATABASE_URL');
    this.appPool = new Pool({ connectionString: appUrl, max: 4 });
  }

  async onModuleInit() {
    await this.ensureStoreTable();
    await this.bootstrapFromFileIfEmpty();
    await this.reloadFromDb();
  }

  async onModuleDestroy() {
    await this.appPool.end();
  }

  getAllTableNames(): readonly string[] {
    return this.tableNames;
  }

  isBiDataTableName(name: string): boolean {
    return this.tableNames.includes(name);
  }

  async setAllTableNames(inputNames: string[]): Promise<readonly string[]> {
    const cleaned = inputNames
      .map((x) => String(x).trim())
      .filter((x) => RE_SAFE_NAME.test(x));
    const unique = [...new Set(cleaned)];
    if (unique.length === 0) {
      throw new Error('La liste des tables BI ne peut pas être vide.');
    }

    const client = await this.appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM public.bi_allowed_tables`);
      for (const t of unique) {
        await client.query(
          `INSERT INTO public.bi_allowed_tables (table_name) VALUES ($1)`,
          [t],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    await this.reloadFromDb();
    return this.tableNames;
  }

  private async ensureStoreTable(): Promise<void> {
    await this.appPool.query(`
      CREATE TABLE IF NOT EXISTS public.bi_allowed_tables (
        table_name varchar(255) PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  private async bootstrapFromFileIfEmpty(): Promise<void> {
    const c = await this.appPool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM public.bi_allowed_tables`,
    );
    const total = Number(c.rows[0]?.total ?? 0);
    if (total > 0) {
      return;
    }
    for (const t of DEFAULT_BI_DATA_TABLES) {
      await this.appPool.query(
        `INSERT INTO public.bi_allowed_tables (table_name) VALUES ($1) ON CONFLICT DO NOTHING`,
        [t],
      );
    }
  }

  private async reloadFromDb(): Promise<void> {
    try {
      const r = await this.appPool.query<{ table_name: string }>(
        `SELECT table_name FROM public.bi_allowed_tables ORDER BY table_name ASC`,
      );
      const names = (r.rows ?? [])
        .map((x) => String(x.table_name).trim())
        .filter((x) => RE_SAFE_NAME.test(x));
      this.tableNames = Object.freeze(
        names.length > 0 ? names : [...DEFAULT_BI_DATA_TABLES],
      ) as readonly string[];
    } catch (e) {
      LOG.warn(
        'Lecture bi_allowed_tables échouée (%s) — fallback',
        (e as Error).message,
      );
      this.tableNames = Object.freeze([...DEFAULT_BI_DATA_TABLES]) as readonly string[];
    }
  }
}
