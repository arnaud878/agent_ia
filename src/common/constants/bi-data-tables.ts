/**
 * Tables métier exposées à l’agent BI (cohérent avec schema.service).
 */
export const BI_DATA_TABLES = [
  'irradiance',
  'production',
  'puissance_installee',
  'vente_carburant',
] as const;

export type BiDataTable = (typeof BI_DATA_TABLES)[number];

export const ALL_BI_DATA_TABLES: ReadonlyArray<string> = [...BI_DATA_TABLES];

export function isBiDataTable(name: string): boolean {
  return (BI_DATA_TABLES as readonly string[]).includes(name);
}
