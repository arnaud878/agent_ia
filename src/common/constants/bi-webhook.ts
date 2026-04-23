/**
 * Cohérence avec l’ancien webhook n8n (path UUID).
 * Valeurs lues dans `.env` (voir `load-env` importé en premier dans `main.ts`) avec repli.
 */
const DEFAULT_N8N_PATH = '5a2715bd-0b56-4e05-9c24-eb48e13c5d7a';
const DEFAULT_STREAM_VERSION = '3';

function envTrim(key: string): string | undefined {
  const v = process.env[key];
  if (v == null || String(v).trim() === '') {
    return undefined;
  }
  return String(v).trim();
}

export const N8N_WEBHOOK_PATH_SEGMENT =
  envTrim('N8N_WEBHOOK_PATH_SEGMENT') ?? DEFAULT_N8N_PATH;

export const BI_STREAM_VERSION_HEADER =
  envTrim('BI_STREAM_VERSION_HEADER') ?? DEFAULT_STREAM_VERSION;
