import {
  buildChartJsConfig,
  buildDynamicReportHtml,
} from './report-html.builder';
import type { BiAnalysisOutput } from '../schemas/bi-output.schema';

const sample: BiAnalysisOutput = {
  resultatSQL: '[]',
  formuleKPI: '',
  dataKPI: '',
  requeteSQL: 'SELECT 1',
  reportSections: {
    title: 'Prédiction des Ventes : Janvier 2024',
    executiveSummary:
      "L'analyse prédictive anticipe un CA de 28,31 Mrd Ar pour janvier 2024.",
    keyInsights: 'Croissance +52,1% vs janvier 2023.',
    operationalActions: [
      'Ajustement : Prévoir stock pour 28B.',
      'Logistique : Réappro semaine 2.',
    ],
    commercialActions: ['Campagne : Relance Janvier -10%.'],
    strategicSummary: 'Tendance haussière malgré la saisonnalité.',
    estimatedBusinessImpact: '~28,3 Mrd Ar (+9,7 Mrd vs Jan 2023).',
    strategicPriorities: [
      'Sécuriser le fonds de roulement.',
      'Monitorer hebdomadairement les prix.',
    ],
    metricHighlights: [],
    recommendations: [],
    sectionPlan: [
      'banner',
      'headline',
      'operational',
      'commercial',
      'strategic',
    ],
  },
};

describe('report-html.builder', () => {
  it('buildChartJsConfig accepte apostrophes dans le titre', () => {
    const cfg = buildChartJsConfig({
      type: 'line',
      labels: ['Jan', 'Fév'],
      data: [1, 2],
      chartTitle: "Évolution du chiffre d'affaires",
      datasetLabel: "CA (Ar)",
    });
    const json = JSON.stringify(cfg);
    expect(json).toContain("d'affaires");
    const html = buildDynamicReportHtml(
      {
        ...sample,
        reportSections: {
          ...sample.reportSections,
          chart: {
            type: 'line',
            labels: ['Jan', 'Fév'],
            data: [10, 20],
            chartTitle: "Chiffre d'Affaires prévisionnel",
            datasetLabel: 'CA',
          },
          sectionPlan: ['banner', 'headline', 'chart'],
        },
      },
      'pro',
      'fr',
    );
    expect(html).toContain("Chiffre d'Affaires prévisionnel");
    expect(html).not.toMatch(/text:\s*'[^']*'[^']*'/);
  });

  it('rend le gabarit avec emojis sections', () => {
    const html = buildDynamicReportHtml(sample, 'quick', 'fr');
    expect(html).toContain('🎯');
    expect(html).toContain('📦 Opérations & Stock');
    expect(html).toContain('📣 Actions Commerciales');
    expect(html).toContain('📊 Résumé Stratégique');
    expect(html).toContain('Impact estimé');
    expect(html).toContain('Priorité 1');
  });
});
