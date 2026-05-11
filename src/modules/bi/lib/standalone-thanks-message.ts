import { inferReplyLocaleFromText, type ReplyLocale } from './message-intent-classifier';

/**
 * Phrases de remerciement seules (aucune autre demande).
 * Court-circuit hors LLM pour éviter de lancer l’agent BI sur un simple « merci ».
 */
const STANDALONE_THANKS = new Set([
  'merci',
  'merci bien',
  'merci beaucoup',
  'merci encore',
  'merci à vous',
  'merci a vous',
  'thanks',
  'thank you',
  'many thanks',
  'thanks a lot',
  'thank u',
  'thx',
  'ty',
  'ok merci',
  'merci ok',
]);

function normalizeStandalonePhrase(raw: string): string {
  let s = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  for (let i = 0; i < 5; i += 1) {
    const next = s.replace(/[.!?,…]+$/u, '').trim();
    if (next === s) break;
    s = next;
  }
  return s;
}

function candidateStandaloneKeys(message: string): string[] {
  const n = normalizeStandalonePhrase(message);
  const keys = new Set<string>([n]);
  const stripped = n.replace(/^(question|q)\s*:\s*/u, '').trim();
  if (stripped !== n) {
    keys.add(stripped);
  }
  return [...keys];
}

/**
 * @returns la locale pour la réponse courte si le message est uniquement un remerciement, sinon null.
 */
export function matchStandaloneThanksMessage(message: string): ReplyLocale | null {
  if (message.length > 96) {
    return null;
  }
  if (/\d/.test(message)) {
    return null;
  }
  if (!candidateStandaloneKeys(message).some((k) => STANDALONE_THANKS.has(k))) {
    return null;
  }
  return inferReplyLocaleFromText(message);
}
