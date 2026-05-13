import { z } from 'zod';

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

/**
 * Sections texte + données structurées pour le rendu HTML (phase 2).
 * Zéro balise HTML — uniquement chaînes, nombres et tableaux.
 */
export const biReportSectionsSchema = z.object({
  title: z.string(),
  keyInsights: z.string(),
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
  recommendations: z.array(z.string()),
  formulasNote: z
    .string()
    .optional()
    .describe('Encart formules / transparence KPI après les recommandations si requis'),
});

export type BiReportSections = z.infer<typeof biReportSectionsSchema>;

/**
 * Phase 1 (agent outils) : pas de HTML — JSON compact par sections.
 */
export const biAnalysisOutputSchema = z.object({
  resultatSQL: z.string().describe("Résultats ou résumé d'exécution SQL"),
  formuleKPI: z.string().describe('Formules KPI utilisées'),
  dataKPI: z.string().describe('Données associées aux KPI'),
  requeteSQL: z.string().describe('Dernière requête SQL pertinente'),
  reportSections: biReportSectionsSchema.describe(
    'Contenu utilisateur pour la phase 2 : titres, insights, tableau, graphique, recommandations — sans HTML',
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
