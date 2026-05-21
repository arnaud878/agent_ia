import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import { AppDbService } from '../db/app-db.service';
import { DEFAULT_BI_DATA_TABLES } from '../constants/bi-data-tables';

const LOG = new Logger('BiDataTablesService');
const RE_SAFE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Registre des tables d'analyse BI (allowlist) : stocké en base
 * dans `public.bi_allowed_tables`.
 */
@Injectable()
export class BiDataTablesService implements OnModuleInit {
  private tableNames: readonly string[] = Object.freeze([
    ...DEFAULT_BI_DATA_TABLES,
  ]);

  constructor(private readonly appDb: AppDbService) {}

  async onModuleInit() {
    await this.ensureStoreTable();
    await this.bootstrapFromFileIfEmpty();
    await this.reloadFromDb();
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

    await this.appDb.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('bi_allowed_tables').execute();
      for (const t of unique) {
        await trx
          .insertInto('bi_allowed_tables')
          .values({ table_name: t })
          .execute();
      }
    });

    await this.reloadFromDb();
    return this.tableNames;
  }

  private async ensureStoreTable(): Promise<void> {
    await this.appDb.executeDdl(`
      CREATE TABLE IF NOT EXISTS public.bi_allowed_tables (
        table_name varchar(255) PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  private async bootstrapFromFileIfEmpty(): Promise<void> {
    const result = await this.appDb.db
      .selectFrom('bi_allowed_tables')
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .executeTakeFirst();

    const total = Number(result?.total ?? 0);
    if (total > 0) {
      return;
    }
    for (const t of DEFAULT_BI_DATA_TABLES) {
      await this.appDb.db
        .insertInto('bi_allowed_tables')
        .values({ table_name: t })
        .onConflict((oc) => oc.column('table_name').doNothing())
        .execute();
    }
  }

  private async reloadFromDb(): Promise<void> {
    try {
      const rows = await this.appDb.db
        .selectFrom('bi_allowed_tables')
        .select('table_name')
        .orderBy('table_name', 'asc')
        .execute();

      const names = rows
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
      this.tableNames = Object.freeze([
        ...DEFAULT_BI_DATA_TABLES,
      ]) as readonly string[];
    }
  }
}
