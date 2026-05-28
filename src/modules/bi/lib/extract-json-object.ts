import {
  prepareModelJsonText,
  tryRepairTruncatedAnalysisJson,
} from './bi-analysis-sanitize';

/** Extrait le premier objet JSON d’une réponse LLM (éventuelle fence markdown ou texte brut). */
export function extractFirstJsonObject(text: string): unknown {
  const s = prepareModelJsonText(text.trim());
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence?.[1] ?? s).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    const repaired = tryRepairTruncatedAnalysisJson(candidate);
    if (repaired != null) {
      return repaired;
    }
    throw new SyntaxError('Aucun objet JSON dans la réponse classifieur');
  }
  const slice = candidate.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    const repaired = tryRepairTruncatedAnalysisJson(candidate);
    if (repaired != null) {
      return repaired;
    }
    throw new SyntaxError('JSON invalide dans la réponse modèle');
  }
}
