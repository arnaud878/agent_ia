import type { BiAnalysisOutput, BiChartSpec } from '../schemas/bi-output.schema';
import {
  reportSectionPlanIds,
  type ReportSectionPlanId,
} from '../schemas/bi-output.schema';
import type { ReplyLocale } from './message-intent-classifier';

type ResponseMode = 'quick' | 'pro';

const BLOCK = (extra: string) =>
  `background:transparent;padding:24px;border-radius:12px;margin-bottom:20px;border:1px solid #444;${extra}`;

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function labels(locale: ReplyLocale) {
  if (locale === 'en') {
    return {
      verify: 'Real-time Verification',
      executedAt: 'executed at',
      notProvided: 'not provided',
      metrics: 'Key metrics',
      diagnostic: 'Detailed analysis',
      forecast: 'Forecast reading',
      operational: 'Operations & Stock',
      commercial: 'Commercial actions',
      strategic: 'Strategic summary',
      recommendations: 'Recommendations',
      formulas: 'Formulas & KPI',
      impact: 'Estimated impact',
      priority: 'Priority',
    };
  }
  return {
    verify: 'Vérification en temps réel',
    executedAt: 'exécuté à',
    notProvided: 'non fourni',
    metrics: 'Indicateurs clés',
    diagnostic: 'Analyse détaillée',
    forecast: 'Lecture de la prévision',
    operational: 'Opérations & Stock',
    commercial: 'Actions Commerciales',
    strategic: 'Résumé Stratégique',
    recommendations: 'Recommandations',
    formulas: 'Formules & KPI',
    impact: 'Impact estimé',
    priority: 'Priorité',
  };
}

function defaultSectionPlan(rs: BiAnalysisOutput['reportSections']): ReportSectionPlanId[] {
  const hasForecast = Boolean(rs.forecastInterpretation?.trim());
  const hasChart = chartIsRenderable(rs.chart);
  const plan: ReportSectionPlanId[] = [
    'banner',
    'headline',
  ];
  if (rs.metricHighlights?.length) {
    plan.push('metrics');
  }
  if (hasForecast) {
    plan.push('forecast_note');
  }
  if (rs.diagnosticDeepDive?.trim() || rs.hypothesesAndLimits?.trim()) {
    plan.push('diagnostic');
  }
  if (hasChart) {
    plan.push('chart');
  }
  if (rs.tableHeaders?.length && rs.tableRows?.length) {
    plan.push('table');
  }
  if (rs.operationalActions?.length) {
    plan.push('operational');
  }
  if (rs.commercialActions?.length) {
    plan.push('commercial');
  }
  if (
    rs.strategicSummary?.trim() ||
    rs.estimatedBusinessImpact?.trim() ||
    (rs.strategicPriorities?.length ?? 0) > 0
  ) {
    plan.push('strategic');
  }
  if (rs.recommendations?.length) {
    plan.push('recommendations');
  }
  if (rs.formulasNote?.trim()) {
    plan.push('formulas');
  }
  return plan;
}

function chartIsRenderable(chart: BiChartSpec | null | undefined): boolean {
  if (!chart?.labels?.length) {
    return false;
  }
  const data = chart.data;
  if (!Array.isArray(data) || data.length !== chart.labels.length) {
    return false;
  }
  return data.every((v) => typeof v === 'number' && Number.isFinite(v));
}

function resolvePlan(rs: BiAnalysisOutput['reportSections']): ReportSectionPlanId[] {
  const raw = rs.sectionPlan?.filter((id) =>
    (reportSectionPlanIds as readonly string[]).includes(id),
  );
  return raw?.length ? raw : defaultSectionPlan(rs);
}

function renderActionList(items: string[]): string {
  const lis = items
    .map((item) => {
      const t = item.trim();
      if (!t) {
        return '';
      }
      const colon = t.indexOf(':');
      if (colon > 0 && colon < 40) {
        const label = t.slice(0, colon).trim();
        const body = t.slice(colon + 1).trim();
        return `<li style="margin-bottom:10px"><strong class="ia-report-strong">${esc(label)} :</strong> <span class="ia-report-body">${esc(body)}</span></li>`;
      }
      return `<li class="ia-report-body" style="margin-bottom:10px">${esc(t)}</li>`;
    })
    .filter(Boolean)
    .join('');
  return `<ul class="ia-report-list" style="line-height:1.75;margin:0;padding-left:20px">${lis}</ul>`;
}

/** Config Chart.js sérialisée en JSON (évite les erreurs de syntaxe avec apostrophes, guillemets, etc.). */
export function buildChartJsConfig(chart: BiChartSpec): Record<string, unknown> {
  const titleText = chart.chartTitle?.trim() ?? '';
  return {
    type: chart.type || 'line',
    data: {
      labels: chart.labels,
      datasets: [
        {
          label: chart.datasetLabel?.trim() || 'Série',
          data: chart.data,
          backgroundColor: 'rgba(78, 121, 167, 0.2)',
          borderColor: '#4e79a7',
          borderWidth: 2,
          tension: 0.35,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#e0e0e0' } },
        title: titleText
          ? { display: true, text: titleText, color: '#e0e0e0' }
          : { display: false },
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: '#444' },
          ticks: { color: '#e0e0e0' },
        },
        x: { grid: { color: '#444' }, ticks: { color: '#e0e0e0' } },
      },
    },
  };
}

function chartScript(chart: BiChartSpec, chartId: string): string {
  const safeId = chartId.replace(/[^a-zA-Z0-9_-]/g, '');
  const configJson = JSON.stringify(buildChartJsConfig(chart));
  return `<script>
(function() {
  const run = () => {
    if (typeof Chart === 'undefined') return;
    const el = document.getElementById(${JSON.stringify(safeId)});
    if (!el) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    try {
      new Chart(ctx, ${configJson});
    } catch (e) {
      console.error('Chart init:', e);
      const wrap = el.closest('.ia-bi-report-chart');
      if (wrap) wrap.style.display = 'none';
    }
  };
  const boot = () => {
    if (typeof Chart !== 'undefined') {
      run();
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js';
    s.crossOrigin = 'anonymous';
    s.onload = run;
    document.head.appendChild(s);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
</script>`;
}

/**
 * Rendu HTML déterministe (gabarit pro type revue de performance / prévision ventes).
 */
export function buildDynamicReportHtml(
  analysis: BiAnalysisOutput,
  responseMode: ResponseMode,
  replyLocale: ReplyLocale,
): string {
  const rs = analysis.reportSections;
  const L = labels(replyLocale);
  const plan = resolvePlan(rs);
  const chartId = `chart_${Date.now()}`;
  const parts: string[] = [
    `<div class="ia-bi-report" style="max-width:1000px;margin:20px auto;font-family:system-ui,sans-serif;color:#e0e0e0;line-height:1.6">`,
  ];

  for (const id of plan) {
    switch (id) {
      case 'banner': {
        const at = rs.executedAtLabel?.trim()
          ? `${L.executedAt} ${esc(rs.executedAtLabel.trim())}`
          : L.notProvided;
        parts.push(
          `<div style="${BLOCK('border-left:3px solid #4e79a7;display:flex;align-items:center;gap:8px;padding:12px 16px')}">`,
          `<span style="color:#4e79a7;font-size:16px">🔍</span>`,
          `<p style="margin:0;font-size:13px"><strong style="color:#4e79a7">${L.verify}</strong> — ${at}</p>`,
          `</div>`,
        );
        break;
      }
      case 'headline': {
        const title = rs.title.trim();
        const titleDisplay = title.startsWith('🎯') ||
          title.startsWith('📊') ||
          title.startsWith('📈')
          ? title
          : `🎯 ${title}`;
        const narrative: string[] = [];
        if (rs.executiveSummary?.trim()) {
          narrative.push(rs.executiveSummary.trim());
        }
        if (rs.keyInsights?.trim()) {
          narrative.push(rs.keyInsights.trim());
        }
        if (rs.forecastInterpretation?.trim() && !plan.includes('forecast_note')) {
          narrative.push(rs.forecastInterpretation.trim());
        }
        parts.push(
          `<div style="${BLOCK('border-left:4px solid #4e79a7')}">`,
          `<h2 style="color:#4e79a7;margin:0 0 14px 0;font-size:1.35rem;line-height:1.35">${esc(titleDisplay)}</h2>`,
          `<div class="ia-report-body" style="line-height:1.7;white-space:pre-wrap;margin:0">${esc(narrative.join('\n\n'))}</div>`,
          `</div>`,
        );
        break;
      }
      case 'metrics': {
        const items = rs.metricHighlights ?? [];
        if (!items.length) {
          break;
        }
        const cards = items
          .map(
            (m) =>
              `<div class="ia-report-body" style="padding:14px 16px;border:1px solid #4e79a7;border-radius:10px;background:rgba(78,121,167,0.08);font-size:0.95rem;line-height:1.5">${esc(m)}</div>`,
          )
          .join('');
        parts.push(
          `<div style="${BLOCK('')}">`,
          `<h3 style="color:#4e79a7;margin:0 0 12px 0;font-size:1.05rem">📌 ${L.metrics}</h3>`,
          `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">${cards}</div>`,
          `</div>`,
        );
        break;
      }
      case 'diagnostic': {
        const body = [rs.diagnosticDeepDive?.trim(), rs.hypothesesAndLimits?.trim()]
          .filter(Boolean)
          .join('\n\n');
        if (!body) {
          break;
        }
        parts.push(
          `<div style="${BLOCK('border-left:4px solid #59a14b')}">`,
          `<h3 style="color:#59a14b;margin:0 0 12px 0;font-size:1.05rem">🔬 ${L.diagnostic}</h3>`,
          `<p class="ia-report-body" style="margin:0;white-space:pre-wrap;line-height:1.7">${esc(body)}</p>`,
          `</div>`,
        );
        break;
      }
      case 'forecast_note': {
        const f = rs.forecastInterpretation?.trim();
        if (!f) {
          break;
        }
        parts.push(
          `<div style="${BLOCK('border-left:4px solid #9b59b6')}">`,
          `<h3 style="color:#9b59b6;margin:0 0 12px 0;font-size:1.05rem">🔮 ${L.forecast}</h3>`,
          `<p style="margin:0;white-space:pre-wrap;line-height:1.7">${esc(f)}</p>`,
          `</div>`,
        );
        break;
      }
      case 'chart': {
        if (responseMode !== 'pro' || !chartIsRenderable(rs.chart)) {
          break;
        }
        const chart = rs.chart!;
        parts.push(
          `<div class="ia-bi-report-chart" style="${BLOCK('padding:12px')}">`,
          `<canvas id="${chartId}"></canvas>`,
          `</div>`,
          chartScript(chart, chartId),
        );
        break;
      }
      case 'table': {
        if (!rs.tableHeaders?.length || !rs.tableRows?.length) {
          break;
        }
        const th = rs.tableHeaders
          .map(
            (h) =>
              `<th class="ia-report-strong" style="padding:12px;border-bottom:2px solid #4e79a7;text-align:left">${esc(String(h))}</th>`,
          )
          .join('');
        const trs = rs.tableRows
          .map((row) => {
            const tds = row
              .map(
                (c) =>
                  `<td class="ia-report-body" style="padding:12px;border-bottom:1px solid #333">${esc(String(c))}</td>`,
              )
              .join('');
            return `<tr>${tds}</tr>`;
          })
          .join('');
        parts.push(
          `<div style="${BLOCK('overflow-x:auto')}">`,
          `<table style="width:100%;border-collapse:collapse"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`,
          `</div>`,
        );
        break;
      }
      case 'operational': {
        const ops = rs.operationalActions ?? [];
        if (!ops.length) {
          break;
        }
        parts.push(
          `<div style="${BLOCK('border-left:4px solid #4e79a7')}">`,
          `<h3 style="color:#4e79a7;margin:0 0 12px 0;font-size:1.05rem">📦 ${L.operational}</h3>`,
          renderActionList(ops),
          `</div>`,
        );
        break;
      }
      case 'commercial': {
        const com = rs.commercialActions ?? [];
        if (!com.length) {
          break;
        }
        parts.push(
          `<div style="${BLOCK('border-left:4px solid #f28e2b')}">`,
          `<h3 style="color:#f28e2b;margin:0 0 12px 0;font-size:1.05rem">📣 ${L.commercial}</h3>`,
          renderActionList(com),
          `</div>`,
        );
        break;
      }
      case 'strategic': {
        const lines: string[] = [];
        if (rs.strategicSummary?.trim()) {
          lines.push(rs.strategicSummary.trim());
        }
        if (rs.estimatedBusinessImpact?.trim()) {
          lines.push(`${L.impact} : ${rs.estimatedBusinessImpact.trim()}`);
        }
        const prios = rs.strategicPriorities ?? [];
        prios.forEach((p, i) => {
          const t = p.trim();
          if (t) {
            const prefixed =
              /^priorit[eé]/i.test(t) || /^priority/i.test(t)
                ? t
                : `${L.priority} ${i + 1} : ${t}`;
            lines.push(prefixed);
          }
        });
        if (!lines.length) {
          break;
        }
        const body = lines.join('\n');
        parts.push(
          `<div style="${BLOCK('border-left:4px solid #e15759')}">`,
          `<h3 style="color:#e15759;margin:0 0 12px 0;font-size:1.05rem">📊 ${L.strategic}</h3>`,
          `<div class="ia-report-body" style="white-space:pre-wrap;line-height:1.75;margin:0">${esc(body)}</div>`,
          `</div>`,
        );
        break;
      }
      case 'recommendations': {
        const recs = rs.recommendations ?? [];
        if (!recs.length) {
          break;
        }
        parts.push(
          `<div style="${BLOCK('border-left:4px solid #5cb85c')}">`,
          `<h3 style="color:#5cb85c;margin:0 0 12px 0;font-size:1.05rem">💡 ${L.recommendations}</h3>`,
          renderActionList(recs),
          `</div>`,
        );
        break;
      }
      case 'formulas': {
        const note =
          rs.formulasNote?.trim() || analysis.formuleKPI?.trim() || '';
        if (!note) {
          break;
        }
        parts.push(
          `<div style="${BLOCK('border-left:4px solid #888')}">`,
          `<h3 style="color:#aaa;margin:0 0 10px 0;font-size:0.95rem">📐 ${L.formulas}</h3>`,
          `<p style="margin:0;white-space:pre-wrap;font-size:0.9rem;opacity:0.92">${esc(note)}</p>`,
          `</div>`,
        );
        break;
      }
      default:
        break;
    }
  }

  parts.push(`</div>`);
  return parts.join('');
}
