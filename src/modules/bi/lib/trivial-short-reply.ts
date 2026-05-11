import type { BiAgentOutput } from '../schemas/bi-output.schema';
import type { ReplyLocale, TrivialShortTone } from './message-intent-classifier';

const CARD_STYLE = `font-family:system-ui,Segoe UI,sans-serif;max-width:42rem;color:#e5e7eb;background:#111827;padding:1rem 1.25rem;border-radius:10px;border:1px solid #374151;line-height:1.5;`;

const P_TITLE = `margin:0 0 0.6rem 0;font-size:1.05rem;font-weight:600;`;
const P_BODY = `margin:0;font-size:0.95rem;opacity:0.95;`;
const P_HINT = `margin:0.75rem 0 0 0;font-size:0.85rem;opacity:0.8;`;

function meta(locale: ReplyLocale): Pick<
  BiAgentOutput,
  'resultatSQL' | 'formuleKPI' | 'dataKPI' | 'requeteSQL'
> {
  if (locale === 'en') {
    return {
      resultatSQL: 'No SQL query (instant reply, no agent).',
      formuleKPI: '—',
      dataKPI: '—',
      requeteSQL: '—',
    };
  }
  return {
    resultatSQL: 'Aucune requête SQL (réponse instantanée, hors agent).',
    formuleKPI: '—',
    dataKPI: '—',
    requeteSQL: '—',
  };
}

function innerHtml(tone: TrivialShortTone, locale: ReplyLocale): string {
  if (locale === 'en') {
    switch (tone) {
      case 'thanks':
        return `<p style="${P_TITLE}">You’re welcome!</p>
<p style="${P_BODY}">Feel free to ask anything about data or KPIs—I can query the database and answer with numbers or charts.</p>`;
      case 'farewell':
        return `<p style="${P_TITLE}">Goodbye</p>
<p style="${P_BODY}">Take care. Come back anytime for analysis or reports.</p>`;
      case 'generic':
        return `<p style="${P_BODY}">I’m here whenever you need help with data analysis (production, KPIs, attachments, etc.).</p>`;
      case 'greeting':
      default:
        return `<p style="${P_TITLE}">Hello!</p>
<p style="${P_BODY}">I’m your data analytics assistant. Ask a specific question and I’ll query the database and respond with figures and charts.</p>
<p style="${P_HINT}">Example: “What was last week’s production by site?”</p>`;
    }
  }
  switch (tone) {
    case 'thanks':
      return `<p style="${P_TITLE}">Avec plaisir !</p>
<p style="${P_BODY}">N’hésitez pas si vous avez une question sur les données ou les indicateurs : j’interroge alors la base et je vous réponds avec des chiffres ou des graphiques.</p>`;
    case 'farewell':
      return `<p style="${P_TITLE}">Au revoir</p>
<p style="${P_BODY}">Bonne continuation. Revenez quand vous voulez pour une analyse ou un rapport.</p>`;
    case 'generic':
      return `<p style="${P_BODY}">Je reste à votre disposition pour toute question d’analyse ou de données (production, KPI, pièces jointes, etc.).</p>`;
    case 'greeting':
    default:
      return `<p style="${P_TITLE}">Bonjour !</p>
<p style="${P_BODY}">Je suis l’assistant analytique des données. Dès que vous posez une question précise, j’interroge la base et je vous réponds avec des chiffres et des graphiques.</p>
<p style="${P_HINT}">Exemple : « Quelle production la semaine dernière, par site ? »</p>`;
  }
}

/**
 * Réponse HTML courte (sans agent outils), selon le ton et la langue (classifieur + repli heuristique).
 */
export function buildTrivialShortReply(
  tone: TrivialShortTone,
  locale: ReplyLocale,
): { output: string } & BiAgentOutput {
  const html = `<div style="${CARD_STYLE}">${innerHtml(tone, locale)}</div>`;
  return {
    output: html,
    html,
    ...meta(locale),
  };
}
