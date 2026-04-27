/**
 * Tables BI par défaut (fallback si `config/bi-data-tables.json` absent ou invalide).
 * La source de vérité à l’exécution est `BiDataTablesService` (fichier JSON).
 */
export const DEFAULT_BI_DATA_TABLES = [
  'irradiance',
  'production',
  'puissance_installee',
  'vente_carburant',
] as const;

export type DefaultBiDataTable = (typeof DEFAULT_BI_DATA_TABLES)[number];
