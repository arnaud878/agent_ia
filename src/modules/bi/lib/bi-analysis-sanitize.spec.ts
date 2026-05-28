import {
  prepareModelJsonText,
  sanitizeAnalysisPayload,
  tryRepairTruncatedAnalysisJson,
} from './bi-analysis-sanitize';

describe('prepareModelJsonText', () => {
  it('collapse runaway (Mrd Ar)', () => {
    const bad = `CA 10 ${'(Mrd Ar) '.repeat(20)}`;
    const out = prepareModelJsonText(bad);
    expect(out.match(/\(Mrd Ar\)/gi)?.length).toBeLessThanOrEqual(2);
  });
});

describe('tryRepairTruncatedAnalysisJson', () => {
  it('repairs json cut mid runaway suffix', () => {
    const inner = `"keyInsights":"Bon ${'(Mrd Ar) '.repeat(30)}`;
    const raw = `{"resultatSQL":"ok","formuleKPI":"f","dataKPI":"d","requeteSQL":"q","reportSections":{${inner}`;
    const obj = tryRepairTruncatedAnalysisJson(raw) as {
      reportSections?: { keyInsights?: string };
    };
    expect(obj?.reportSections?.keyInsights).toContain('Bon');
    expect(obj?.reportSections?.keyInsights?.match(/\(Mrd Ar\)/gi)?.length ?? 0).toBeLessThanOrEqual(2);
  });
});

describe('sanitizeAnalysisPayload', () => {
  it('truncates long keyInsights', () => {
    const obj = sanitizeAnalysisPayload({
      resultatSQL: 'x',
      formuleKPI: 'f',
      dataKPI: 'd',
      requeteSQL: 'q',
      reportSections: {
        title: 'T',
        keyInsights: 'a'.repeat(10_000),
      },
    }) as { reportSections: { keyInsights: string } };
    expect(obj.reportSections.keyInsights.length).toBeLessThan(5000);
  });
});
