/** Identifiants stables (clé primaire `bi_agent_prompts.id`). */
export const AGENT_PROMPT_IDS = [
  'static',
  'html-render',
  'mode-quick',
  'formule-kpi',
] as const;

export type AgentPromptId = (typeof AGENT_PROMPT_IDS)[number];

export type AgentPromptPlaceholder = {
  token: string;
  descriptionFr: string;
  descriptionEn: string;
};

export type AgentPromptDefinition = {
  id: AgentPromptId;
  fileName: string;
  labelFr: string;
  labelEn: string;
  /** Variables à conserver si l’utilisateur personnalise le prompt */
  placeholders: readonly AgentPromptPlaceholder[];
};

export const AGENT_PROMPT_DEFINITIONS: readonly AgentPromptDefinition[] = [
  {
    id: 'static',
    fileName: 'static.txt',
    labelFr: 'Prompt principal (phase analyse)',
    labelEn: 'Main prompt (analysis phase)',
    placeholders: [
      {
        token: '__RESPONSE_MODE_BLOCK__',
        descriptionFr:
          'Remplacé par les consignes « mode rapide » (fichier mode-quick) aux emplacements prévus, ou rien en mode pro.',
        descriptionEn:
          'Replaced by quick-mode instructions (mode-quick file) at each marker, or empty in pro mode.',
      },
      {
        token: '__SCHEMA_BLOCK__',
        descriptionFr:
          'Injecté par le serveur : schéma PostgreSQL des tables BI (JSON).',
        descriptionEn:
          'Injected by the server: PostgreSQL schema JSON for BI tables.',
      },
      {
        token: '__KPI_BLOCK__',
        descriptionFr:
          'Injecté par le serveur : contenu du prompt « formule-kpi » stocké en base (modèle d’installation défini dans l’application si non personnalisé).',
        descriptionEn:
          'Injected by the server: content of the `formule-kpi` prompt stored in the database (install template from the app if not customized).',
      },
    ],
  },
  {
    id: 'html-render',
    fileName: 'html-render.txt',
    labelFr: 'Rendu HTML (phase 2)',
    labelEn: 'HTML rendering (phase 2)',
    placeholders: [
      {
        token: '(message utilisateur)',
        descriptionFr:
          'Le modèle reçoit un JSON (`responseMode`, `replyLocale`, `analysis` avec `reportSections`) : pas de marqueur dans ce fichier.',
        descriptionEn:
          'The model receives JSON (`responseMode`, `replyLocale`, `analysis` with `reportSections`): no placeholders in this file.',
      },
    ],
  },
  {
    id: 'mode-quick',
    fileName: 'mode-quick.txt',
    labelFr: 'Mode réponse rapide',
    labelEn: 'Quick reply mode',
    placeholders: [
      {
        token: '(injection)',
        descriptionFr:
          'Ce bloc est inséré dans le prompt principal à la place de `__RESPONSE_MODE_BLOCK__` (texte du prompt « mode-quick » en base).',
        descriptionEn:
          'Inserted into the main prompt where `__RESPONSE_MODE_BLOCK__` stands (text of the `mode-quick` prompt in the database).',
      },
    ],
  },
  {
    id: 'formule-kpi',
    fileName: 'formule-kpi.txt',
    labelFr: 'Annexe formules KPI',
    labelEn: 'KPI formulas appendix',
    placeholders: [],
  },
] as const;

export function getAgentPromptDefinition(
  id: string,
): AgentPromptDefinition | undefined {
  return AGENT_PROMPT_DEFINITIONS.find((d) => d.id === id);
}
