/**
 * Détection des tentatives d’injection / contournement du prompt (FR + EN).
 * 1) Sous-chaînes fiables après normalisation (évite les trous des regex)
 * 2) Regex en complément
 */
export const USER_MESSAGE_BLOCKED =
  "Ce type de consigne n'est pas autorisé. Merci de poser une question sur les données (production, irradiance, carburant, etc.)." as const;

/** Normalise pour comparaison (casse, espaces, compatibilité d’apostrophes / accents proches) */
function normForBlock(s: string): string {
  return s
    .normalize('NFC')
    .replace(/\u00a0/g, ' ')
    .replace(/[''′]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const BLOCK_PHRASES: readonly string[] = [
  'ignore all previous',
  'ignorez les consignes',
  'oublie les instructions',
  'oubliez les consignes',
  'désactive le prompt',
  "n'exécute pas le prompt",
  "n'execute pas le prompt", // graphie sans accent
  'ne pas executer le prompt',
  'ne pas exécuter le prompt',
  'ne pas executer le prompt system',
  'ne pas exécuter le prompt system',
  'ne pas executer le prompt système',
  'ne pas exécuter le prompt système',
  'ne pas appliquer le prompt',
  'ne pas appliquer les consignes',
  'ne pas suivre le prompt',
  'ne pas suivre les consignes',
  // Evasion: « … prompt / system … mais dire … »
  'prompt system mais',
  'le prompt system mais',
  'jailbreak',
];

const PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instruction|message|prompt|system)/i,
  /disregard\s+(the\s+)?(system|above|instruction|rules)/i,
  /do\s+not\s+follow(\s+the)?\s+system(\s+prompt|instruction)*/i,
  /(don'?t|do\s+not)\s+execute(\s+the)?\s+system(\s+prompt)*/i,
  /reveal\s+(your|the)\s+system(\s+prompt)*/i,
  /developer\s+message\s*:/i,
  /(\[|\()?\s*system\s*(\]|\))?\s*:\s*you/i,
  /\b(dan|jailbreak|do-anything-now)\b/i,
  /ignore[ez]?\s+(toutes?\s+)?(les\s+)?(consignes|instructions)(\s+pr[ée]c[ée]dentes|\s+du\s*syst[èe]m[ee]|\s+ci[- ]dessus)?/i,
  /oubli[ez]?\s+(toutes?\s+)?(les\s+)?(consignes|instructions|le\s+prompt)/i,
  // n'… / ne pas …
  /n['’]ex[ée]cut(e|ez)\s+pas(\s+le)?\s+prompt(\s+syst[èe]m[ee])?/i,
  /ne\s+pas\s+ex[ée]cut[ée]r?\b[^.!?\n]{0,80}?(le\s+)?prompt/i,
  /ne\s+pas\s+ex[ée]cut[ée]r?(\s+le)?\s+prompt(\s+syst[èe]m[ee])?/i,
  /ne\s+pas\s+(suivre|appliquer)\s+((les|le)\s+)?(consignes?|instructions?)\s+((du\s+)?syst[èe]m[ee]|syst[èe]miques)/i,
  /d[ée]sactive[rz]?\s+(le\s+)?prompt(\s+syst[èe]m[ee])?/i,
  /contourn(e|er)\s+(le\s+)?(syst[èe]m[ee]|le\s+prompt|les\s+consignes)/i,
  /(joue|incarne)\s+un\s+autre\s+r[ôo]le/i,
  // Evasion: « … prompt … mais dire … (je suis / tout simplement) »
  /prompt.{0,50}mais\W{0,15}(dire|dis|répond|fournis?|mets?)\b[\s\S]{0,70}(tout|tous)\s*simplement/i,
  /prompt.{0,50}mais\W{0,15}(dire|dis|répond|fournis?|mets?)\b[\s\S]{0,40}je\s+su[ie]s/i,
];

/**
 * Renvoie `true` si le texte ressemble à une attaque (consigne pour ignorer le système, etc.).
 */
export function isLikelyUserPromptInjection(message: string): boolean {
  const t = message.normalize('NFC');
  const n = normForBlock(t);
  for (const p of BLOCK_PHRASES) {
    if (n.includes(p)) {
      return true;
    }
  }
  for (const re of PATTERNS) {
    if (re.test(t)) {
      return true;
    }
  }
  return false;
}
