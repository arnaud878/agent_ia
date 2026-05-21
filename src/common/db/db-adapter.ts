import { Pool as PgPool } from 'pg';
import * as mysql from 'mysql2/promise';

export type DbType = 'postgresql' | 'mysql';

export interface DbQueryResult<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  rows: T[];
  rowCount: number | null;
}

export interface DbAdapter {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<DbQueryResult<T>>;
  end(): Promise<void>;
}

class PgDbAdapter implements DbAdapter {
  private readonly pool: PgPool;

  constructor(connectionString: string, maxConnections = 10) {
    this.pool = new PgPool({ connectionString, max: maxConnections });
  }

  async query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<DbQueryResult<T>> {
    const res =
      params && params.length > 0
        ? await this.pool.query<T>(sql, params)
        : await this.pool.query<T>(sql);
    return { rows: res.rows, rowCount: res.rowCount };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

class MysqlDbAdapter implements DbAdapter {
  private readonly pool: mysql.Pool;

  constructor(connectionString: string) {
    this.pool = mysql.createPool(connectionString);
  }

  async query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<DbQueryResult<T>> {
    const [rows] =
      params && params.length > 0
        ? await this.pool.query(sql, params)
        : await this.pool.query(sql);
    const rowsArr = Array.isArray(rows) ? (rows as T[]) : [];
    return { rows: rowsArr, rowCount: rowsArr.length };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

export function createDbAdapter(
  dbType: DbType,
  connectionString: string,
  maxConnections = 10,
): DbAdapter {
  if (dbType === 'mysql') {
    return new MysqlDbAdapter(connectionString);
  }
  return new PgDbAdapter(connectionString, maxConnections);
}

/**
 * Teste la connexion en créant un pool temporaire (max=1), exécute SELECT 1 puis le détruit.
 */
export async function testDbConnection(
  dbType: DbType,
  connectionString: string,
): Promise<void> {
  const adapter = createDbAdapter(dbType, connectionString, 1);
  try {
    await adapter.query('SELECT 1');
  } finally {
    await adapter.end();
  }
}
