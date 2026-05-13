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

/**
 * Phase 1 (agent outils) : pas de HTML volumineux — évite la troncature du JSON structuré.
 */
export const biAnalysisOutputSchema = z.object({
  resultatSQL: z.string().describe("Résultats ou résumé d'exécution SQL"),
  formuleKPI: z.string().describe('Formules KPI utilisées'),
  dataKPI: z.string().describe('Données associées aux KPI'),
  requeteSQL: z.string().describe('Dernière requête SQL pertinente'),
  analysisSummary: z
    .string()
    .describe(
      'Synthèse factuelle dense (texte brut, pas HTML) : titre du rapport, insights clés, valeurs pour tableaux/graphiques (labels, séries numériques), recommandations — tout le nécessaire pour que la phase 2 génère uniquement la mise en page.',
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
