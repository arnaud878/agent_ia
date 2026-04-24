import { tool } from '@langchain/core/tools';
import { Parser } from 'expr-eval';
import { z } from 'zod';
import {
  ALL_BI_DATA_TABLES,
  isBiDataTable,
} from '../../../common/constants/bi-data-tables';
import { assertSelectSqlUsesOnlyAllowedTables } from '../../../common/lib/sql-table-allow';
import type { DataAccess } from '../../../common/types/data-access';
import type { SchemaService } from '../services/schema.service';

function ensureSelectReadOnly(sql: string): { sql: string; warning?: string } {
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

function allowedTableSetForAccess(data: DataAccess): Set<string> {
  if (data.kind === 'all') {
    return new Set(ALL_BI_DATA_TABLES);
  }
  return new Set(data.tableNames.filter((t) => isBiDataTable(t)));
}

/**
 * Outils n8n; `dataAccess` restreint les tables SQL et le schéma injecté côté agent.
 */
export function buildBiTools(
  schemaService: SchemaService,
  dataAccess: DataAccess,
) {
  const allow = allowedTableSetForAccess(dataAccess);
  const sqlExecutor = tool(
    async (input: { sql_query: string }) => {
      if (allow.size === 0) {
        throw new Error(
          'Aucune table n’est autorisée pour ce compte. Contactez un administrateur.',
        );
      }
      const { sql, warning } = ensureSelectReadOnly(input.sql_query);
      assertSelectSqlUsesOnlyAllowedTables(sql, allow);
      const res = await schemaService.executeQuery(sql);
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
        "Exécute une requête SQL en lecture seule sur PostgreSQL. Passe l’argument 'sql_query'.",
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

  return [sqlExecutor, think, calculator] as const;
}
