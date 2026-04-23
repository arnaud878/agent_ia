import type { BiAgentOutput } from './bi-output.schema';

/**
 * Détecte une salutation courte, sans demande d’analyse (évite l’agent LLM).
 */
export function isSimpleGreeting(message: string): boolean {
  const s = message.trim().replace(/\s+/g, ' ');
  if (s.length === 0 || s.length > 72) {
    return false;
  }
  const normalized = s
    .replace(/[!?.…,:;]+$/gu, '')
    .trim()
    .toLowerCase();

  const single = new Set([
    'bonjour',
    'salut',
    'coucou',
    'bonsoir',
    'hello',
    'hi',
    'hey',
    'slt',
    'yo',
    'cc',
    'bonne journée',
    'bonne soirée',
    'good morning',
    'good evening',
    'good afternoon',
    'hi there',
    'hey there',
  ]);

  if (single.has(normalized)) {
    return true;
  }

  const twoWord = /^(bonjour|salut|hello|hi|hey|bonsoir) (tout le monde|à tous|la team|l’équipe|l\'équipe|monde)$/;
  if (twoWord.test(normalized)) {
    return true;
  }

  return false;
}

export function buildGreetingResponse(): { output: string } & BiAgentOutput {
  const html = `<div style="font-family:system-ui,Segoe UI,sans-serif;max-width:42rem;color:#e5e7eb;background:#111827;padding:1rem 1.25rem;border-radius:10px;border:1px solid #374151;line-height:1.5;">
<p style="margin:0 0 0.6rem 0;font-size:1.05rem;font-weight:600;">Bonjour !</p>
<p style="margin:0;font-size:0.95rem;opacity:0.95;">Je suis l’assistant analytique des données (production, irradiance, sites, carburant). Dès que vous posez une question précise, j’interroge la base et je vous réponds avec des chiffres et des graphiques.</p>
<p style="margin:0.75rem 0 0 0;font-size:0.85rem;opacity:0.8;">Exemple : « Quelle production sur le site X la semaine dernière ? »</p>
</div>`;

  return {
    output: html,
    html,
    resultatSQL: 'Aucune requête SQL (réponse instantanée, hors agent).',
    formuleKPI: '—',
    dataKPI: '—',
    requeteSQL: '—',
  };
}
