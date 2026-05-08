/**
 * Tables BI par défaut (seed initial si aucune table n'est encore configurée en base).
 * La source de vérité à l’exécution est `BiDataTablesService` (fichier JSON).
 */
export const DEFAULT_BI_DATA_TABLES = [
  'irradiance',
  'production',
  'puissance_installee',
  'vente_carburant',
] as const;

export type DefaultBiDataTable = (typeof DEFAULT_BI_DATA_TABLES)[number];
