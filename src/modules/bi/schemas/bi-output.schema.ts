import { z } from 'zod';
import { BI_FIELD_LIMITS } from '../lib/bi-analysis-sanitize';

/**
 * Même sortie structurée que le n8n "Structured Output Parser".
 */
export const biAgentOutputSchema = z.object({
  html: z.string().describe('Contenu HTML stylé intégral'),
  resultatSQL: z.string().describe("Résultats ou résumé d'exécution SQL"),
  formuleKPI: z.string().describe('Formules KPI utilisées'),
  dataKPI: z.string().describe('Données associées aux KPI'),
  requeteSQL: z.string().describe('Dernière requête SQL pertinente'),
});

export type BiAgentOutput = z.infer<typeof biAgentOutputSchema>;

/** Série graphique pour la phase 2 (aucun HTML en phase 1). */
export const biChartSpecSchema = z.object({
  type: z.string().describe('Type Chart.js : line, bar, pie, etc.'),
  labels: z.array(z.string()),
  data: z.array(z.number()),
  datasetLabel: z.string().optional(),
  chartTitle: z.string().optional(),
});

export type BiChartSpec = z.infer<typeof biChartSpecSchema>;

/** Ordre des blocs HTML — adapté à chaque question (rendu non uniforme). */
export const reportSectionPlanIds = [
  'banner',
  'headline',
  'metrics',
  'diagnostic',
  'chart',
  'table',
  'forecast_note',
  'operational',
  'commercial',
  'strategic',
  'recommendations',
  'formulas',
] as const;

export type ReportSectionPlanId = (typeof reportSectionPlanIds)[number];

/**
 * Sections texte + données structurées pour le rendu HTML (phase 2).
 * Zéro balise HTML — uniquement chaînes, nombres et tableaux.
 */
export const biReportSectionsSchema = z.object({
  title: z.string().max(BI_FIELD_LIMITS.title),
  analysisAngle: z
    .string()
    .max(BI_FIELD_LIMITS.analysisAngle)
    .optional()
    .describe(
      'Angle précis de cette réponse (ex. "Évolution CA mensuel", "Prévision trimestrielle") — titre de section dynamique',
    ),
  executiveSummary: z
    .string()
    .max(BI_FIELD_LIMITS.executiveSummary)
    .optional()
    .describe(
      '2–4 phrases : réponse directe à la question avec chiffres clés et verdict business',
    ),
  keyInsights: z
    .string()
    .max(BI_FIELD_LIMITS.keyInsights)
    .describe(
      'Synthèse percutante (4–8 phrases) : tendance, écart, lecture métier — jamais générique',
    ),
  diagnosticDeepDive: z
    .string()
    .max(BI_FIELD_LIMITS.diagnosticDeepDive)
    .optional()
    .describe(
      'Interprétation expert détaillée : pourquoi, drivers, segments, saisonnalité, risques — 8–12 phrases en mode pro, 5–8 en rapide',
    ),
  metricHighlights: z
    .array(z.string().max(BI_FIELD_LIMITS.metricHighlight))
    .default([])
    .describe(
      '3–6 puces chiffrées commentées (valeur + % + interprétation courte), ex. "CA 1,24 Mds Ar (+8,3% vs N-1) — tiré par …"',
    ),
  hypothesesAndLimits: z
    .string()
    .max(BI_FIELD_LIMITS.hypothesesAndLimits)
    .optional()
    .describe(
      'Hypothèses, limites des données, périmètre analysé, ce qui reste incertain',
    ),
  forecastInterpretation: z
    .string()
    .max(BI_FIELD_LIMITS.forecastInterpretation)
    .optional()
    .describe(
      'Si prévision : lecture des dates/forecast/bornes, modèle, prudence — sinon omettre',
    ),
  sectionPlan: z
    .array(z.enum(reportSectionPlanIds))
    .optional()
    .describe(
      'Ordre des blocs pour CETTE question uniquement (omettre les ids sans contenu). Varier selon le type de demande.',
    ),
  executedAtLabel: z
    .string()
    .optional()
    .describe(
      "Horodatage ou libellé court pour le bandeau (ex. 14:32:01) — pas de HTML",
    ),
  tableHeaders: z.array(z.string()).optional(),
  tableRows: z
    .array(z.array(z.union([z.string(), z.number()])))
    .optional()
    .describe('Une ligne par enregistrement ; même nombre de cellules que tableHeaders'),
  chart: biChartSpecSchema.nullish(),
  operationalActions: z
    .array(z.string().max(BI_FIELD_LIMITS.actionLine))
    .default([])
    .describe(
      'Format "Libellé : détail" — ex. "Ajustement : Prévoir stock pour 28B Ar", "Logistique : Réappro semaine 2" ; [] si non pertinent.',
    ),
  commercialActions: z
    .array(z.string().max(BI_FIELD_LIMITS.actionLine))
    .default([])
    .describe(
      'Format "Libellé : détail" — ex. "Campagne : Relance Janvier -10%", "Fidélisation : Cibler acheteurs décembre" ; [] si non pertinent.',
    ),
  strategicSummary: z
    .string()
    .max(BI_FIELD_LIMITS.strategicSummary)
    .optional()
    .describe(
      'Résumé stratégique : tendance en 1–2 phrases (ex. "Tendance fortement haussière malgré la saisonnalité…")',
    ),
  estimatedBusinessImpact: z
    .string()
    .max(BI_FIELD_LIMITS.estimatedBusinessImpact)
    .optional()
    .describe(
      'Impact chiffré (ex. "~28,3 Mrd Ar (+9,7 Mrd Ar vs Janvier 2023)")',
    ),
  strategicPriorities: z
    .array(z.string().max(BI_FIELD_LIMITS.actionLine))
    .default([])
    .describe(
      '2–3 priorités actionnables (ex. "Sécuriser le fonds de roulement pour…") — affichées Priorité 1, 2…',
    ),
  recommendations: z
    .array(z.string().max(BI_FIELD_LIMITS.actionLine))
    .default([])
    .describe(
      'Recommandations transverses complémentaires (générales ou transverses) ; peut rester [] si tout est déjà couvert par les blocs ci-dessus.',
    ),
  formulasNote: z
    .string()
    .max(BI_FIELD_LIMITS.formulasNote)
    .optional()
    .describe('Encart formules / transparence KPI après les recommandations si requis'),
});

export type BiReportSections = z.infer<typeof biReportSectionsSchema>;

/**
 * Phase 1 (agent outils) : pas de HTML — JSON compact par sections.
 */
export const biAnalysisOutputSchema = z.object({
  resultatSQL: z
    .string()
    .max(BI_FIELD_LIMITS.resultatSQL)
    .describe("Résultats ou résumé d'exécution SQL"),
  formuleKPI: z
    .string()
    .max(BI_FIELD_LIMITS.formuleKPI)
    .describe('Formules KPI utilisées'),
  dataKPI: z
    .string()
    .max(BI_FIELD_LIMITS.dataKPI)
    .describe('Données associées aux KPI'),
  requeteSQL: z
    .string()
    .max(BI_FIELD_LIMITS.requeteSQL)
    .describe('Dernière requête SQL pertinente'),
  reportSections: biReportSectionsSchema.describe(
    'Contenu utilisateur phase 2 : narration experte (executiveSummary, diagnosticDeepDive, metricHighlights), tableau, graphique, actions, sectionPlan dynamique — sans HTML',
  ),
});

export type BiAnalysisOutput = z.infer<typeof biAnalysisOutputSchema>;

/** Phase 2 : rendu HTML seul (sous-agent sans outils). */
export const biHtmlRenderOutputSchema = z.object({
  html: z
    .string()
    .describe(
      'HTML pur pour l’utilisateur (voir modèle de page : indicateur temps réel, titres, graphique Chart.js si pertinent, tableau, recommandations).',
    ),
});

export type BiHtmlRenderOutput = z.infer<typeof biHtmlRenderOutputSchema>;

export function mergeAnalysisAndHtmlToBiOutput(
  analysis: BiAnalysisOutput,
  render: BiHtmlRenderOutput,
): BiAgentOutput {
  return {
    resultatSQL: analysis.resultatSQL,
    formuleKPI: analysis.formuleKPI,
    dataKPI: analysis.dataKPI,
    requeteSQL: analysis.requeteSQL,
    html: render.html,
  };
}
