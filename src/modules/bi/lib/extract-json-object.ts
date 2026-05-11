/** Extrait le premier objet JSON d’une réponse LLM (éventuelle fence markdown ou texte brut). */
export function extractFirstJsonObject(text: string): unknown {
  const s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fence?.[1] ?? s).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new SyntaxError('Aucun objet JSON dans la réponse classifieur');
  }
  return JSON.parse(candidate.slice(start, end + 1));
}
