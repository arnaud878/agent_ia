import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type QueryResult } from 'pg';

/** Même requête que le n8n "Execute a SQL query" (noms de tables cohérents avec la base). */
const SCHEMA_QUERY = `SELECT
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
    c.table_name IN (
        'irradiance',
        'production',
        'puissance_installee',
        'vente_carburant'
    )
ORDER BY
    c.table_name,
    c.ordinal_position`;

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
export class SchemaService implements OnModuleDestroy {
  private pool: Pool;

  /** Cache du JSON « Info BDD » (metadata) : évite une requête `information_schema` à chaque tour. */
  private bddJsonCache: {
    data: { bdd: { json: BddSchema } };
    expiresAt: number;
  } | null = null;

  constructor(private readonly config: ConfigService) {
    const url = this.config.getOrThrow<string>('DATABASE_URL');
    this.pool = new Pool({ connectionString: url, max: 10 });
  }

  onModuleDestroy() {
    return this.pool.end();
  }

  getPool(): Pool {
    return this.pool;
  }

  /** Exécution bas niveau (outil SQL, paramètres optionnels $1, $2, …). */
  async executeQuery(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<Record<string, unknown>>> {
    if (params && params.length > 0) {
      return this.pool.query<Record<string, unknown>>(sql, params);
    }
    return this.pool.query<Record<string, unknown>>(sql);
  }

  /**
   * Reconstruit l’objet `bdd: { json: schema }` comme le n8n "Info BDD".
   * Mis en cache mémoire selon `BDD_SCHEMA_CACHE_TTL_SECONDS` (0 = pas de cache).
   */
  async getBddJson(): Promise<{ bdd: { json: BddSchema } }> {
    const ttlSec = this.parseTtlSeconds(
      this.config.get<string>('BDD_SCHEMA_CACHE_TTL_SECONDS'),
    );
    const now = Date.now();
    if (
      ttlSec > 0 &&
      this.bddJsonCache &&
      now < this.bddJsonCache.expiresAt
    ) {
      return this.bddJsonCache.data;
    }

    const res = await this.pool.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      character_maximum_length: number | null;
      is_nullable: string;
      constraint_type: string | null;
      foreign_table_name: string | null;
      foreign_column_name: string | null;
    }>(SCHEMA_QUERY);
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
