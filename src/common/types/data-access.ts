/**
 * Portée des données pour une requête webhook (clé API = tout, JWT = selon le rôle).
 */
export type DataAccess =
  | { kind: 'all' }
  | { kind: 'restricted'; tableNames: string[] };
