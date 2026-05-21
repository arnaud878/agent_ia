import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompiledQuery, Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { AppDatabase } from './app-db.types';

export type { AppDatabase };

@Injectable()
export class AppDbService implements OnModuleDestroy {
  /** Instance Kysely typée — utilisée directement par les services. */
  readonly db: Kysely<AppDatabase>;
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    const connectionString = config.getOrThrow<string>('DATABASE_URL');
    this.pool = new Pool({ connectionString, max: 20 });
    this.db = new Kysely<AppDatabase>({
      dialect: new PostgresDialect({ pool: this.pool }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.destroy();
  }

  /**
   * Exécute du SQL brut paramétré (paramètres positionnels $1, $2…).
   * Utilisé pour les requêtes complexes difficiles à exprimer avec le query builder.
   */
  async executeRaw<T extends Record<string, unknown>>(
    query: string,
    params?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    const result = await this.db.executeQuery<T>(
      CompiledQuery.raw(query, params ?? []),
    );
    return {
      rows: result.rows,
      rowCount:
        result.numAffectedRows !== undefined
          ? Number(result.numAffectedRows)
          : result.rows.length,
    };
  }

  /**
   * Exécute un fragment SQL DDL (CREATE TABLE IF NOT EXISTS, ALTER TABLE…).
   * Pas de valeur de retour utile.
   */
  async executeDdl(query: string): Promise<void> {
    await sql.raw(query).execute(this.db);
  }
}
