/**
 * Nettoie les sorties phase 1 : boucles « (Mrd Ar) » (troncature / OUTPUT_PARSING_FAILURE)
 * et champs texte trop longs pour le schéma Zod.
 */

const RUNAWAY_MRD_AR_PAREN =
  /(?:\(\s*Mrd\s+Ar\s*\)\s*){4,}/gi;
const RUNAWAY_MRD_AR_PLAIN = /(?:Mrd\s+Ar\s*){8,}/gi;

export const BI_FIELD_LIMITS = {
  resultatSQL: 16_000,
  formuleKPI: 6_000,
  dataKPI: 8_000,
  requeteSQL: 4_000,
  keyInsights: 4_500,
  diagnosticDeepDive: 5_500,
  executiveSummary: 2_500,
  strategicSummary: 2_500,
  forecastInterpretation: 2_500,
  hypothesesAndLimits: 2_500,
  estimatedBusinessImpact: 800,
  formulasNote: 2_000,
  title: 400,
  analysisAngle: 200,
  actionLine: 500,
  metricHighlight: 400,
  tableCell: 200,
} as const;

/** Réduit les répétitions pathologiques avant extraction JSON. */
export function prepareModelJsonText(text: string): string {
  let s = text;
  s = s.replace(RUNAWAY_MRD_AR_PAREN, '(Mrd Ar) ');
  s = s.replace(RUNAWAY_MRD_AR_PLAIN, 'Mrd Ar ');
  return s;
}

function truncateField(value: string, max: number): string {
  const t = value.trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max - 1)}…`;
}

function sanitizeString(
  value: unknown,
  max: number,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const collapsed = prepareModelJsonText(value);
  return truncateField(collapsed, max);
}

/** Applique limites sur un objet brut avant validation Zod. */
export function sanitizeAnalysisPayload(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }
  const o = { ...(obj as Record<string, unknown>) };
  o.resultatSQL = sanitizeString(o.resultatSQL, BI_FIELD_LIMITS.resultatSQL);
  o.formuleKPI = sanitizeString(o.formuleKPI, BI_FIELD_LIMITS.formuleKPI);
  o.dataKPI = sanitizeString(o.dataKPI, BI_FIELD_LIMITS.dataKPI);
  o.requeteSQL = sanitizeString(o.requeteSQL, BI_FIELD_LIMITS.requeteSQL);

  const rs = o.reportSections;
  if (rs && typeof rs === 'object' && !Array.isArray(rs)) {
    const r = { ...(rs as Record<string, unknown>) };
    r.title = sanitizeString(r.title, BI_FIELD_LIMITS.title);
    r.analysisAngle = sanitizeString(
      r.analysisAngle,
      BI_FIELD_LIMITS.analysisAngle,
    );
    r.executiveSummary = sanitizeString(
      r.executiveSummary,
      BI_FIELD_LIMITS.executiveSummary,
    );
    r.keyInsights = sanitizeString(r.keyInsights, BI_FIELD_LIMITS.keyInsights);
    r.diagnosticDeepDive = sanitizeString(
      r.diagnosticDeepDive,
      BI_FIELD_LIMITS.diagnosticDeepDive,
    );
    r.hypothesesAndLimits = sanitizeString(
      r.hypothesesAndLimits,
      BI_FIELD_LIMITS.hypothesesAndLimits,
    );
    r.forecastInterpretation = sanitizeString(
      r.forecastInterpretation,
      BI_FIELD_LIMITS.forecastInterpretation,
    );
    r.strategicSummary = sanitizeString(
      r.strategicSummary,
      BI_FIELD_LIMITS.strategicSummary,
    );
    r.estimatedBusinessImpact = sanitizeString(
      r.estimatedBusinessImpact,
      BI_FIELD_LIMITS.estimatedBusinessImpact,
    );
    r.formulasNote = sanitizeString(
      r.formulasNote,
      BI_FIELD_LIMITS.formulasNote,
    );
    r.executedAtLabel = sanitizeString(r.executedAtLabel, 80);

    for (const key of [
      'operationalActions',
      'commercialActions',
      'strategicPriorities',
      'recommendations',
      'metricHighlights',
    ] as const) {
      const arr = r[key];
      if (Array.isArray(arr)) {
        const max =
          key === 'metricHighlights'
            ? BI_FIELD_LIMITS.metricHighlight
            : BI_FIELD_LIMITS.actionLine;
        r[key] = arr
          .map((item) => sanitizeString(item, max))
          .filter((x): x is string => Boolean(x));
      }
    }

    if (Array.isArray(r.tableRows)) {
      r.tableRows = r.tableRows.map((row) => {
        if (!Array.isArray(row)) {
          return row;
        }
        return row.map((cell) => {
          if (typeof cell === 'number') {
            return cell;
          }
          return (
            sanitizeString(String(cell), BI_FIELD_LIMITS.tableCell) ?? ''
          );
        });
      });
    }

    o.reportSections = r;
  }

  return o;
}

/**
 * Tente de réparer un JSON tronqué après une boucle « (Mrd Ar) ».
 */
export function tryRepairTruncatedAnalysisJson(text: string): unknown | null {
  const start = text.indexOf('{');
  if (start < 0) {
    return null;
  }
  const runaway = /(?:\(\s*Mrd\s+Ar\s*\)\s*){4,}/i.exec(text);
  if (!runaway || runaway.index <= start) {
    return null;
  }
  let slice = text.slice(start, runaway.index).trimEnd();
  if (slice.endsWith(',')) {
    slice = slice.slice(0, -1);
  }
  const openString = /"[^"\\]*$/;
  if (openString.test(slice)) {
    slice += '"';
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (const ch of slice) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
      }
    }
  }
  if (inString) {
    slice += '"';
  }
  while (depth > 0) {
    slice += '}';
    depth -= 1;
  }
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}
