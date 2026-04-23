import { ToolMessage } from '@langchain/core/messages';

/**
 * Un appel d’outils côté modèle (noms possibles : SQLExecutor, Think, `function.name`, etc.).
 */
export function extractToolCallName(tc: unknown): string {
  if (tc && typeof tc === 'object') {
    const o = tc as Record<string, unknown>;
    if (typeof o.name === 'string' && o.name.trim().length) {
      return o.name;
    }
    const fn = o.function;
    if (fn && typeof fn === 'object' && (fn as { name?: string }).name) {
      return String((fn as { name: string }).name);
    }
  }
  return 'unknown';
}

/**
 * Regroupement des noms techniques vers un petit nombre de catégories métier.
 */
export function classifyToolName(
  name: string,
): 'sql' | 'think' | 'calc' | 'unknown' {
  const s = (name || '').toLowerCase().replace(/[\s_-]/g, '');
  if (s.includes('sql') || s.includes('sqlexecutor')) {
    return 'sql';
  }
  if (s.includes('think')) {
    return 'think';
  }
  if (s.includes('calculator') || s === 'calc' || s.includes('calculat')) {
    return 'calc';
  }
  return 'unknown';
}

function looksLikeSqlResultPayload(text: string): boolean {
  const t = text.trim();
  if (t.startsWith('{') && t.includes('"rowCount"')) {
    return true;
  }
  if (t.includes('rowCount') && (t.includes('rows') || t.includes('warning'))) {
    return true;
  }
  return false;
}

export function inferToolNameFromMessage(m: ToolMessage): string {
  const n = m.name;
  if (n && n.trim().length) {
    return n;
  }
  const text =
    typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
  if (looksLikeSqlResultPayload(text)) {
    return 'SQLExecutor';
  }
  return 'unknown';
}

/**
 * Libellés 100 % utilisateur (aucun nom d’outil).
 * `nextSql` compte les libellés « récupération » pour varier l’intitulé à chaque tour.
 */
export function humanizeToolCallBatch(
  rawNames: string[],
  sqlIntentCount: number,
): { line: string; nextSql: number } {
  const kinds = new Set(rawNames.map((r) => classifyToolName(r)));
  const hasSql = kinds.has('sql');
  const hasThink = kinds.has('think');
  const hasCalc = kinds.has('calc');
  let nextSql = sqlIntentCount;
  if (hasSql) {
    nextSql += 1;
  }
  if (hasSql && hasThink && hasCalc) {
    return {
      line: 'Récupération des données, approfondissement de l’analyse et calculs d’indicateurs…',
      nextSql,
    };
  }
  if (hasSql && hasThink) {
    return {
      line: 'Lecture de la base et affinage de l’analyse de votre question…',
      nextSql,
    };
  }
  if (hasSql && hasCalc) {
    return {
      line: 'Lecture de la base et calcul des indicateurs chiffrés…',
      nextSql,
    };
  }
  if (hasThink && hasCalc) {
    return {
      line: 'Analyse de la requête et calcul des indicateurs…',
      nextSql,
    };
  }
  if (hasSql) {
    if (nextSql <= 1) {
      return {
        line: 'Récupération des données …',
        nextSql,
      };
    }
    return {
      line: `Nouvelle récupération de données (étape ${nextSql})…`,
      nextSql,
    };
  }
  if (hasThink) {
    return {
      line: 'Analyse de la question et structuration de la démarche…',
      nextSql,
    };
  }
  if (hasCalc) {
    return { line: 'Calculs sur les chiffres et les indicateurs…', nextSql };
  }
  return { line: 'Traitement de votre demande en cours…', nextSql };
}

/**
 * Libellé après exécution d’une brique (résultat pris en compte dans la suite).
 */
export function humanizeToolResult(
  toolName: string,
  content: string,
): string | null {
  const k = classifyToolName(toolName);
  const effective: 'sql' | 'think' | 'calc' | 'unknown' =
    k === 'unknown' && looksLikeSqlResultPayload(content) ? 'sql' : k;
  if (effective === 'sql') {
    try {
      const j = JSON.parse(content) as { rowCount?: number };
      const n =
        typeof j?.rowCount === 'number' && Number.isFinite(j.rowCount)
          ? j.rowCount
          : null;
      if (n === null) {
        return 'Données reçues et analysées (résultat intégré).';
      }
      if (n === 0) {
        return 'Aucun enregistrement ne correspond (0 ligne) — poursuite de l’analyse.';
      }
      if (n === 1) {
        return '1 enregistrement reçu, pris en compte pour la suite du raisonnement.';
      }
      return `${n} enregistrements reçus et pris en compte pour la suite.`;
    } catch {
      return 'Nouveaux chiffres reçus et intégrés à l’analyse.';
    }
  }
  if (effective === 'think') {
    return 'Analyse intermédiaire enregistrée (orientation de la réponse)…';
  }
  if (effective === 'calc') {
    return 'Calculs mis à jour pour la suite du raisonnement…';
  }
  return 'Étape prise en compte pour la suite…';
}
