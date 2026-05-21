import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import {
  createDbAdapter,
  testDbConnection,
  type DbAdapter,
  type DbQueryResult,
  type DbType,
} from '../../../common/db/db-adapter';
import { BiDataTablesService } from '../../../common/bi-tables/bi-data-tables.service';

/** Requête de schéma PostgreSQL (information_schema standard + constraint_column_usage) */
const SCHEMA_SELECT_PG = `SELECT
    c.table_name,
    c.column_name,
    c.data_type,
    c.character_maximum_length,
    c.is_nullable,
    c.column_default,
    tc.constraint_type,
    tc.constraint_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM
    information_schema.columns AS c
    LEFT JOIN information_schema.key_column_usage AS kcu
        ON c.table_name = kcu.table_name
        AND c.column_name = kcu.column_name
    LEFT JOIN information_schema.table_constraints AS tc
        ON tc.constraint_name = kcu.constraint_name
    LEFT JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
WHERE
    c.table_name IN (%IN%)
ORDER BY
    c.table_name,
    c.ordinal_position`;

/** Requête de schéma MySQL (KEY_COLUMN_USAGE + DATABASE() pour le schéma courant) */
const SCHEMA_SELECT_MYSQL = `SELECT
    c.TABLE_NAME AS table_name,
    c.COLUMN_NAME AS column_name,
    c.DATA_TYPE AS data_type,
    c.CHARACTER_MAXIMUM_LENGTH AS character_maximum_length,
    c.IS_NULLABLE AS is_nullable,
    c.COLUMN_DEFAULT AS column_default,
    CASE
        WHEN kcu.CONSTRAINT_NAME = 'PRIMARY' THEN 'PRIMARY KEY'
        WHEN kcu.REFERENCED_TABLE_NAME IS NOT NULL THEN 'FOREIGN KEY'
        ELSE NULL
    END AS constraint_type,
    kcu.CONSTRAINT_NAME AS constraint_name,
    kcu.REFERENCED_TABLE_NAME AS foreign_table_name,
    kcu.REFERENCED_COLUMN_NAME AS foreign_column_name
FROM
    information_schema.COLUMNS AS c
    LEFT JOIN information_schema.KEY_COLUMN_USAGE AS kcu
        ON c.TABLE_NAME = kcu.TABLE_NAME
        AND c.COLUMN_NAME = kcu.COLUMN_NAME
        AND c.TABLE_SCHEMA = kcu.TABLE_SCHEMA
WHERE
    c.TABLE_NAME IN (%IN%)
    AND c.TABLE_SCHEMA = DATABASE()
ORDER BY
    c.TABLE_NAME,
    c.ORDINAL_POSITION`;

export type BddColumnMeta = {
  type: string;
  nullable: boolean;
  pk?: boolean;
  fk?: string;
};

export type BddSchema = Record<
  string,
  { columns: Record<string, BddColumnMeta> }
>;

@Injectable()
export class SchemaService implements OnModuleInit, OnModuleDestroy {
  private readonly appPool: Pool;
  private biAdapter: DbAdapter;
  private biAdapterIsShared: boolean;

  /** Cache du JSON « Info BDD » (metadata) : évite une requête `information_schema` à chaque tour. */
  private bddJsonCache: {
    data: { bdd: { json: BddSchema } };
    expiresAt: number;
  } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly biTables: BiDataTablesService,
  ) {
    const appUrl = this.config.getOrThrow<string>('DATABASE_URL');
    this.appPool = new Pool({ connectionString: appUrl, max: 10 });
    this.biAdapter = this.buildPgAdapterFromPool();
    this.biAdapterIsShared = true;
  }

  async onModuleInit() {
    await this.ensureBiConnectionTable();
    await this.reloadBiAdapterFromSettings();
  }

  onModuleDestroy() {
    const closeApp = this.appPool.end();
    if (this.biAdapterIsShared) {
      return closeApp;
    }
    return Promise.all([closeApp, this.biAdapter.end()]).then(() => undefined);
  }

  async getBiConnectionSettings(): Promise<{
    connectionString: string | null;
    dbType: DbType;
  }> {
    const r = await this.appPool.query<{
      connection_string: string;
      db_type: string;
    }>(
      `SELECT connection_string, db_type FROM public.bi_connection_settings WHERE id = true`,
    );
    const row = r.rows[0];
    if (!row) {
      return { connectionString: null, dbType: 'postgresql' };
    }
    const dbType: DbType =
      row.db_type === 'mysql' ? 'mysql' : 'postgresql';
    return {
      connectionString: row.connection_string?.trim() || null,
      dbType,
    };
  }

  /** @deprecated Use getBiConnectionSettings */
  async getBiConnectionString(): Promise<string | null> {
    const { connectionString } = await this.getBiConnectionSettings();
    return connectionString;
  }

  async setBiConnection(
    connectionString: string,
    dbType: DbType = 'postgresql',
  ): Promise<void> {
    const s = connectionString.trim();
    if (!s) {
      await this.appPool.query(
        `DELETE FROM public.bi_connection_settings WHERE id = true`,
      );
      await this.reloadBiAdapterFromSettings();
      return;
    }
    await testDbConnection(dbType, s);
    await this.appPool.query(
      `INSERT INTO public.bi_connection_settings (id, connection_string, db_type, updated_at)
       VALUES (true, $1, $2, now())
       ON CONFLICT (id)
       DO UPDATE SET connection_string = EXCLUDED.connection_string,
                     db_type = EXCLUDED.db_type,
                     updated_at = now()`,
      [s, dbType],
    );
    await this.reloadBiAdapterFromSettings();
  }

  /** @deprecated Use setBiConnection */
  async setBiConnectionString(connectionString: string): Promise<void> {
    await this.setBiConnection(connectionString, 'postgresql');
  }

  /**
   * Base applicative (IAM, rôles, conversations, historique, …).
   */
  async executeAppQuery(
    sql: string,
    params?: unknown[],
  ): Promise<DbQueryResult<Record<string, unknown>>> {
    if (params && params.length > 0) {
      const res = await this.appPool.query<Record<string, unknown>>(
        sql,
        params,
      );
      return { rows: res.rows, rowCount: res.rowCount };
    }
    const res = await this.appPool.query<Record<string, unknown>>(sql);
    return { rows: res.rows, rowCount: res.rowCount };
  }

  /**
   * Base analytique (tables BI configurées en base via admin, requêtes de l'agent).
   */
  async executeBiQuery(
    sql: string,
    params?: unknown[],
  ): Promise<DbQueryResult<Record<string, unknown>>> {
    return this.biAdapter.query<Record<string, unknown>>(sql, params);
  }

  private async ensureBiConnectionTable(): Promise<void> {
    await this.appPool.query(`
      CREATE TABLE IF NOT EXISTS public.bi_connection_settings (
        id boolean PRIMARY KEY DEFAULT true,
        connection_string text NOT NULL,
        db_type varchar(20) NOT NULL DEFAULT 'postgresql',
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT bi_connection_settings_singleton_chk CHECK (id = true)
      )
    `);
    await this.appPool.query(`
      ALTER TABLE public.bi_connection_settings
      ADD COLUMN IF NOT EXISTS db_type varchar(20) NOT NULL DEFAULT 'postgresql'
    `);
  }

  private async reloadBiAdapterFromSettings(): Promise<void> {
    const appUrl = this.config.getOrThrow<string>('DATABASE_URL');
    const { connectionString: configured, dbType } =
      await this.getBiConnectionSettings();

    const isDefault =
      !configured || configured.length === 0 || configured === appUrl;

    if (isDefault && dbType === 'postgresql') {
      if (!this.biAdapterIsShared) {
        await this.biAdapter.end();
      }
      this.biAdapter = this.buildPgAdapterFromPool();
      this.biAdapterIsShared = true;
      return;
    }

    const biUrl = configured && configured.length > 0 ? configured : appUrl;
    const newAdapter = createDbAdapter(dbType, biUrl);
    await newAdapter.query('SELECT 1');

    if (!this.biAdapterIsShared) {
      await this.biAdapter.end();
    }
    this.biAdapter = newAdapter;
    this.biAdapterIsShared = false;
  }

  /** Enveloppe le appPool dans un DbAdapter partagé (sans le fermer indépendamment). */
  private buildPgAdapterFromPool(): DbAdapter {
    const pool = this.appPool;
    return {
      query: async <T extends Record<string, unknown>>(
        sql: string,
        params?: unknown[],
      ) => {
        const res =
          params && params.length > 0
            ? await pool.query<T>(sql, params)
            : await pool.query<T>(sql);
        return { rows: res.rows, rowCount: res.rowCount };
      },
      end: async () => {
        /* no-op : géré par appPool */
      },
    };
  }

  private buildBddSchemaQuery(dbType: DbType): string {
    const list = this.biTables
      .getAllTableNames()
      .filter((t) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t));
    if (list.length === 0) {
      throw new Error('Aucune table BI valide configurée.');
    }
    const inList = list.map((t) => `'${t.replace(/'/g, "''")}'`).join(', ');
    const tpl = dbType === 'mysql' ? SCHEMA_SELECT_MYSQL : SCHEMA_SELECT_PG;
    return tpl.replace('%IN%', inList);
  }

  /**
   * Reconstruit l'objet `bdd: { json: schema }`.
   * Mis en cache mémoire selon `BDD_SCHEMA_CACHE_TTL_SECONDS` (0 = pas de cache).
   */
  async getBddJson(): Promise<{ bdd: { json: BddSchema } }> {
    const ttlSec = this.parseTtlSeconds(
      this.config.get<string>('BDD_SCHEMA_CACHE_TTL_SECONDS'),
    );
    const now = Date.now();
    if (ttlSec > 0 && this.bddJsonCache && now < this.bddJsonCache.expiresAt) {
      return this.bddJsonCache.data;
    }

    const { dbType } = await this.getBiConnectionSettings();
    const schemaQuery = this.buildBddSchemaQuery(dbType);
    const res = await this.biAdapter.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      character_maximum_length: number | null;
      is_nullable: string;
      constraint_type: string | null;
      foreign_table_name: string | null;
      foreign_column_name: string | null;
    }>(schemaQuery);

    const data: { bdd: { json: BddSchema } } = {
      bdd: { json: this.mapRowsToBdd(res.rows) },
    };
    if (ttlSec > 0) {
      this.bddJsonCache = {
        data,
        expiresAt: Date.now() + ttlSec * 1000,
      };
    } else {
      this.bddJsonCache = null;
    }
    return data;
  }

  private parseTtlSeconds(raw: string | undefined): number {
    if (raw == null || String(raw).trim() === '') {
      return 300;
    }
    const n = parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 0) {
      return 300;
    }
    return n;
  }

  private mapRowsToBdd(
    input: {
      table_name: string;
      column_name: string;
      data_type: string;
      character_maximum_length: number | null;
      is_nullable: string;
      constraint_type: string | null;
      foreign_table_name: string | null;
      foreign_column_name: string | null;
    }[],
  ): BddSchema {
    const schema: BddSchema = {};
    for (const col of input) {
      const table = col.table_name;
      if (!schema[table]) {
        schema[table] = { columns: {} };
      }
      const columnData: BddColumnMeta = {
        type: this.formatType(col),
        nullable: col.is_nullable === 'YES',
      };
      if (col.constraint_type === 'PRIMARY KEY') {
        columnData.pk = true;
      }
      if (
        col.constraint_type === 'FOREIGN KEY' &&
        col.foreign_table_name &&
        col.foreign_column_name
      ) {
        columnData.fk = `${col.foreign_table_name}.${col.foreign_column_name}`;
      }
      schema[table].columns[col.column_name] = columnData;
    }
    return schema;
  }

  private formatType(col: {
    data_type: string;
    character_maximum_length: number | null;
  }): string {
    if (
      col.data_type === 'character varying' &&
      col.character_maximum_length != null
    ) {
      return `varchar(${col.character_maximum_length})`;
    }
    return col.data_type;
  }
}
