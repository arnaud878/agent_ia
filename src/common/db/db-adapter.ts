import { Pool as PgPool } from 'pg';
import * as mysql from 'mysql2/promise';
import sql from 'mssql';

export type DbType = 'postgresql' | 'mysql' | 'mssql';

export interface DbQueryResult<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  rows: T[];
  rowCount: number | null;
}

export interface DbAdapter {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sqlText: string,
    params?: unknown[],
  ): Promise<DbQueryResult<T>>;
  end(): Promise<void>;
}

/** Normalise une URL `mssql://` vers une chaîne ADO acceptée par le driver `mssql`. */
export function normalizeMssqlConnectionString(connectionString: string): string {
  const s = connectionString.trim();
  if (!/^mssql:\/\//i.test(s)) {
    return s;
  }
  const u = new URL(s);
  const port = u.port ? `,${u.port}` : '';
  const server = `${u.hostname}${port}`;
  const database = u.pathname.replace(/^\//, '') || '';
  const user = decodeURIComponent(u.username);
  const password = decodeURIComponent(u.password);
  const parts = [
    `Server=${server}`,
    database ? `Database=${database}` : '',
    user ? `User Id=${user}` : '',
    password ? `Password=${password}` : '',
    'Encrypt=true',
    'TrustServerCertificate=true',
  ].filter(Boolean);
  return parts.join(';');
}

class PgDbAdapter implements DbAdapter {
  private readonly pool: PgPool;

  constructor(connectionString: string, maxConnections = 10) {
    this.pool = new PgPool({ connectionString, max: maxConnections });
  }

  async query<T extends Record<string, unknown>>(
    sqlText: string,
    params?: unknown[],
  ): Promise<DbQueryResult<T>> {
    const res =
      params && params.length > 0
        ? await this.pool.query<T>(sqlText, params)
        : await this.pool.query<T>(sqlText);
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
    sqlText: string,
    params?: unknown[],
  ): Promise<DbQueryResult<T>> {
    const [rows] =
      params && params.length > 0
        ? await this.pool.query(sqlText, params)
        : await this.pool.query(sqlText);
    const rowsArr = Array.isArray(rows) ? (rows as T[]) : [];
    return { rows: rowsArr, rowCount: rowsArr.length };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

class MssqlDbAdapter implements DbAdapter {
  private pool: sql.ConnectionPool | null = null;
  private readonly config: string;

  constructor(connectionString: string) {
    this.config = normalizeMssqlConnectionString(connectionString);
  }

  private async getPool(): Promise<sql.ConnectionPool> {
    if (!this.pool) {
      this.pool = await new sql.ConnectionPool(this.config).connect();
    }
    return this.pool;
  }

  async query<T extends Record<string, unknown>>(
    sqlText: string,
    _params?: unknown[],
  ): Promise<DbQueryResult<T>> {
    const pool = await this.getPool();
    const result = await pool.request().query(sqlText);
    const rows = (result.recordset ?? []) as T[];
    return { rows, rowCount: rows.length };
  }

  async end(): Promise<void> {
    if (this.pool) {
      await this.pool.close();
      this.pool = null;
    }
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
  if (dbType === 'mssql') {
    return new MssqlDbAdapter(connectionString);
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

export function parseStoredDbType(raw: string | null | undefined): DbType {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'mysql') {
    return 'mysql';
  }
  if (v === 'mssql') {
    return 'mssql';
  }
  return 'postgresql';
}
