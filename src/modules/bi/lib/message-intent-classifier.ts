import { z } from 'zod';

export const trivialShortToneSchema = z.enum([
  'greeting',
  'thanks',
  'farewell',
  'generic',
]);

export type TrivialShortTone = z.infer<typeof trivialShortToneSchema>;

export const replyLocaleSchema = z.enum(['fr', 'en']);

export type ReplyLocale = z.infer<typeof replyLocaleSchema>;

/** Sortie structurée de l’agent classifieur d’intention. */
export const socialTrivialIntentSchema = z.object({
  trivial: z
    .boolean()
    .describe(
      'true si le message ne requiert pas l’agent BI (pas de demande données / PJ / analyse métier)',
    ),
  shortTone: trivialShortToneSchema
    .optional()
    .describe(
      'Si trivial=true : thanks | greeting | farewell | generic. Si trivial=false, utiliser generic.',
    ),
  replyLocale: replyLocaleSchema
    .optional()
    .describe(
      'Langue du message utilisateur : fr ou en (pour la réponse HTML courte si trivial=true ; sinon indiquer quand même la langue détectée).',
    ),
});

export type SocialTrivialIntent = z.infer<typeof socialTrivialIntentSchema>;

/** Consigne ajoutée au repli JSON brut (évite les échecs de parsing structured output). */
export const INTENT_CLASSIFIER_JSON_SUFFIX = `

Réponse obligatoire : un seul objet JSON valide (UTF-8), sans markdown ni texte autour.
Clés : "trivial" (booléen), "shortTone" ("greeting"|"thanks"|"farewell"|"generic", optionnel), "replyLocale" ("fr"|"en", optionnel).`;

/** Repère fr/en sans LLM si le modèle omet replyLocale. */
export function inferReplyLocaleFromText(message: string): ReplyLocale {
  const s = message.toLowerCase();
  const n = s.replace(/[^\p{L}\s']/gu, ' ');
  const hasEn =
    /\b(hello|hi|hey|thanks|thank you|the |you |what |how |please|could |show |data |chart |report|morning|evening)\b/u.test(
      n,
    );
  const hasFr =
    /\b(bonjour|salut|merci|vous |les |données|quelle|combien|bonsoir|tableau|combien de)\b/u.test(
      n,
    );
  if (hasEn && !hasFr) {
    return 'en';
  }
  if (hasFr && !hasEn) {
    return 'fr';
  }
  return 'fr';
}

export { SOCIAL_TRIVIAL_CLASSIFIER_SYSTEM } from '../prompts/social-trivial-classifier';
