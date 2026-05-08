import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, type QueryResult } from 'pg';
import { BiDataTablesService } from '../../../common/bi-tables/bi-data-tables.service';

const SCHEMA_SELECT = `SELECT
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
  private readonly appPool: Pool;
  private readonly biPool: Pool;
  private readonly biPoolIsShared: boolean;

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
    const biRaw = this.config.get<string>('BI_DATABASE_URL')?.trim() ?? '';
    const biUrl = biRaw !== '' ? biRaw : appUrl;
    this.appPool = new Pool({ connectionString: appUrl, max: 10 });
    if (biUrl === appUrl) {
      this.biPool = this.appPool;
      this.biPoolIsShared = true;
    } else {
      this.biPool = new Pool({ connectionString: biUrl, max: 10 });
      this.biPoolIsShared = false;
    }
  }

  onModuleDestroy() {
    const closeApp = this.appPool.end();
    if (this.biPoolIsShared) {
      return closeApp;
    }
    return Promise.all([closeApp, this.biPool.end()]).then(() => undefined);
  }

  /**
   * Base applicative (IAM, rôles, conversations, historique n8n, …).
   */
  async executeAppQuery(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<Record<string, unknown>>> {
    if (params && params.length > 0) {
      return this.appPool.query<Record<string, unknown>>(sql, params);
    }
    return this.appPool.query<Record<string, unknown>>(sql);
  }

  /**
   * Base analytique (tables BI configurées en base via admin, requêtes de l’agent).
   */
  async executeBiQuery(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<Record<string, unknown>>> {
    if (params && params.length > 0) {
      return this.biPool.query<Record<string, unknown>>(sql, params);
    }
    return this.biPool.query<Record<string, unknown>>(sql);
  }

  private buildBddSchemaQuery(): string {
    const list = this.biTables
      .getAllTableNames()
      .filter((t) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t));
    if (list.length === 0) {
      throw new Error('Aucune table BI valide configurée.');
    }
    const inList = list.map((t) => `'${t.replace(/'/g, "''")}'`).join(', ');
    return SCHEMA_SELECT.replace('%IN%', inList);
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
    if (ttlSec > 0 && this.bddJsonCache && now < this.bddJsonCache.expiresAt) {
      return this.bddJsonCache.data;
    }

    const schemaQuery = this.buildBddSchemaQuery();
    const res = await this.biPool.query<{
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
