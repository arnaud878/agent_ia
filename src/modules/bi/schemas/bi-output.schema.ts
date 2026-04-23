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
