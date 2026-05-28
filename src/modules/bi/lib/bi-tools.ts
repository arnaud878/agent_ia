import { tool } from '@langchain/core/tools';
import { Parser } from 'expr-eval';
import { z } from 'zod';
import { BiDataTablesService } from '../../../common/bi-tables/bi-data-tables.service';
import { assertSelectSqlUsesOnlyAllowedTables } from '../../../common/lib/sql-table-allow';
import type { DbType } from '../../../common/db/db-adapter';
import type { DataAccess } from '../../../common/types/data-access';
import type { SchemaService } from '../services/schema.service';
import {
  callForecastApi,
  normalizeForecastApiUrl,
  parseForecastRequestJson,
} from './forecast-api.client';

function ensureSelectReadOnly(
  sql: string,
  dbType: DbType,
): { sql: string; warning?: string } {
  const trimmed = sql.trim();
  if (!/^\s*(with|select)\b/is.test(trimmed)) {
    throw new Error(
      'Seules les requêtes SELECT (éventuellement WITH … SELECT) sont autorisées.',
    );
  }
  const blockers = [
    'insert',
    'update',
    'delete',
    'drop',
    'truncate',
    'alter',
    'create',
    'grant',
    'revoke',
  ];
  for (const b of blockers) {
    if (new RegExp(`\\b${b}\\b`, 'i').test(trimmed)) {
      throw new Error(`Opération interdite détectée: ${b.toUpperCase()}`);
    }
  }
  const withoutSemi = trimmed.replace(/;+\s*$/g, '');
  if (dbType === 'mssql') {
    if (!/\bTOP\s+\d+\b/i.test(withoutSemi) && !/\bLIMIT\s+\d+\b/i.test(withoutSemi)) {
      return {
        sql: withoutSemi.replace(/^\s*select\b/i, 'SELECT TOP 500'),
        warning: 'TOP 500 appliqué automatiquement.',
      };
    }
    return { sql: withoutSemi };
  }
  if (!/\blimit\s+\d+\b/i.test(withoutSemi)) {
    return {
      sql: `${withoutSemi} LIMIT 500`,
      warning: 'LIMIT 500 appliqué automatiquement.',
    };
  }
  return { sql: withoutSemi };
}

function safeEvalExpression(expr: string): string {
  const safe = expr.replace(/[^0-9eE.+\-*/()\s]/g, '');
  if (safe.length > 300) {
    return 'Error: expression trop longue';
  }
  if (!safe.trim().length) {
    return 'Error: expression vide';
  }
  try {
    const parser = new Parser();
    const v: number = parser.parse(safe).evaluate() as number;
    return String(v);
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

function allowedTableSetForAccess(
  data: DataAccess,
  biTables: BiDataTablesService,
): Set<string> {
  if (data.kind === 'all') {
    return new Set(biTables.getAllTableNames());
  }
  return new Set(
    data.tableNames.filter((t) => biTables.isBiDataTableName(t)),
  );
}

export type BuildBiToolsOptions = {
  /** URL POST de l’API Forecast (défaut : service Render public). */
  forecastApiUrl?: string;
};

/**
 * Outils n8n; `dataAccess` restreint les tables SQL et le schéma injecté côté agent.
 */
export function buildBiTools(
  schemaService: SchemaService,
  dataAccess: DataAccess,
  biTables: BiDataTablesService,
  options?: BuildBiToolsOptions,
) {
  const forecastApiUrl = normalizeForecastApiUrl(options?.forecastApiUrl);
  const allow = allowedTableSetForAccess(dataAccess, biTables);
  const sqlExecutor = tool(
    async (input: { sql_query: string }) => {
      if (allow.size === 0) {
        throw new Error(
          'Aucune table n’est autorisée pour ce compte. Contactez un administrateur.',
        );
      }
      const { dbType } = await schemaService.getBiConnectionSettings();
      const { sql, warning } = ensureSelectReadOnly(input.sql_query, dbType);
      assertSelectSqlUsesOnlyAllowedTables(sql, allow, dbType);
      const res = await schemaService.executeBiQuery(sql);
      const text = JSON.stringify(
        { rows: res.rows, rowCount: res.rowCount, warning: warning ?? null },
        null,
        2,
      );
      if (text.length > 200_000) {
        return text.slice(0, 200_000) + '…(tronqué)';
      }
      return text;
    },
    {
      name: 'SQLExecutor',
      description:
        "Exécute une requête SQL en lecture seule (SELECT) sur la base BI connectée. Passe l'argument 'sql_query'.",
      schema: z.object({
        sql_query: z.string().describe('Requête SQL SELECT (schéma validé)'),
      }),
    },
  );

  const think = tool(
    (input: { thought: string }) => `noté: ${input.thought.slice(0, 4000)}`,
    {
      name: 'Think',
      description:
        "Raisonnement interne court. Ne sert qu'à structurer l’analyse (équivalent n8n toolThink).",
      schema: z.object({
        thought: z
          .string()
          .describe("Étape de raisonnement (plan d'action, hypothèses)"),
      }),
    },
  );

  const calculator = tool(
    (input: { expression: string }) => safeEvalExpression(input.expression),
    {
      name: 'calculator',
      description:
        'Évalue une expression arithmétique numérique (+ - * / parenthèses).',
      schema: z.object({
        expression: z.string().describe('Expression, ex. (12.3 + 4) * 0.2'),
      }),
    },
  );

  const forecast = tool(
    async (input: { request_json: string }) => {
      try {
        const req = parseForecastRequestJson(input.request_json);
        const res = await callForecastApi(forecastApiUrl, req);
        const text = JSON.stringify(res, null, 2);
        if (text.length > 200_000) {
          return text.slice(0, 200_000) + '…(tronqué)';
        }
        return text;
      } catch (e) {
        const msg = (e as Error).message;
        return (
          `Error: ${msg}\n` +
          'Consigne : en SQL, GROUP BY période (date/mois) avec SUM(valeur), alias date + value, 24–60 lignes max — pas 500 lignes détail. ' +
          'Puis un seul nouvel appel Forecast avec request_json corrigé (ne pas boucler indéfiniment).'
        );
      }
    },
    {
      name: 'Forecast',
      description:
        "Appel API Forecast (équivalent n8n Forecasting_API). Corps JSON complet dans request_json. " +
        'Workflow : 1) SQL agrégé (GROUP BY période, SUM) → 2) request_json = {"data":[{date,value},...],"horizon":N,"frequency":"M|D|W|Y","model":"prophet|arima|auto","date_column":"date","value_column":"value"}. ' +
        'Le serveur agrège/nettoie si trop de lignes. Ne pas inventer de prévisions.',
      schema: z.object({
        request_json: z
          .string()
          .describe(
            'Objet JSON stringifié : data (tableau), horizon, frequency, model, date_column, value_column (format identique n8n)',
          ),
      }),
    },
  );

  return [sqlExecutor, think, calculator, forecast] as const;
}
