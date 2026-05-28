export const DEFAULT_FORECAST_API_URL =
  'https://forecasting-api-6l1j.onrender.com/api/v1/forecast';

export type ForecastFrequency = 'D' | 'W' | 'M' | 'Y';
export type ForecastModel = 'prophet' | 'arima' | 'auto';

export interface ForecastApiRequest {
  data: Record<string, unknown>[];
  horizon: number;
  frequency?: ForecastFrequency;
  model?: ForecastModel;
  date_column?: string | null;
  value_column?: string | null;
}

export interface ForecastApiResponse {
  dates: string[];
  forecast: number[];
  lower_bound?: number[] | null;
  upper_bound?: number[] | null;
}

/** Points envoyés à l’API après agrégation (aligné n8n : série temporelle, pas lignes détail). */
export const FORECAST_MAX_SERIES_POINTS = 120;
/** Lignes SQL brutes acceptées avant agrégation côté serveur. */
export const FORECAST_MAX_RAW_ROWS = 5000;
export const FORECAST_MAX_HORIZON = 120;
/** Render cold start : n8n utilise 10s mais échoue souvent ; 90s plus réaliste. */
export const FORECAST_REQUEST_TIMEOUT_MS = 90_000;

const MODEL_LABELS: Record<ForecastModel, string> = {
  prophet: 'Prophet (Facebook)',
  arima: 'ARIMA',
  auto: 'sélection automatique (Prophet ou ARIMA selon les données)',
};

const DATE_KEY_HINTS = [
  'date',
  'ds',
  'jour',
  'mois',
  'periode',
  'period',
  'datetime',
  'time',
];
const VALUE_KEY_HINTS = [
  'value',
  'y',
  'ca',
  'volume',
  'total',
  'montant',
  'qty',
  'quantite',
  'qte',
  'sum',
  'valeur',
  'ventes',
  'amount',
];

export function forecastMethodologyLabel(model: ForecastModel): string {
  return MODEL_LABELS[model];
}

export function normalizeForecastApiUrl(raw: string | undefined): string {
  const t = (raw ?? '').trim();
  return t.length > 0 ? t : DEFAULT_FORECAST_API_URL;
}

function pickColumn(
  row: Record<string, unknown>,
  explicit: string | null | undefined,
  hints: string[],
): string | null {
  if (explicit?.trim()) {
    const k = explicit.trim();
    if (k in row) {
      return k;
    }
  }
  const keys = Object.keys(row);
  for (const hint of hints) {
    const found = keys.find(
      (k) => k.toLowerCase() === hint || k.toLowerCase().includes(hint),
    );
    if (found) {
      return found;
    }
  }
  return null;
}

function parseRowDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function periodKey(d: Date, frequency: ForecastFrequency): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  if (frequency === 'Y') {
    return `${y}-01-01`;
  }
  if (frequency === 'M') {
    return `${y}-${m}-01`;
  }
  if (frequency === 'W') {
    const tmp = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const week = Math.ceil(
      ((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
    );
    return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  return `${y}-${m}-${day}`;
}

/**
 * Nettoie et agrège les lignes SQL (souvent 500 détail) en série temporelle
 * `{ date, value }` comme le flux n8n Forecasting_API.
 */
export function sanitizeForecastSeries(
  rows: Record<string, unknown>[],
  opts: {
    frequency?: ForecastFrequency;
    date_column?: string | null;
    value_column?: string | null;
  },
): {
  data: { date: string; value: number }[];
  notes: string[];
  input_rows: number;
} {
  const notes: string[] = [];
  const frequency = opts.frequency ?? 'M';
  if (!rows.length) {
    throw new Error('Aucune ligne dans data.');
  }
  if (rows.length > FORECAST_MAX_RAW_ROWS) {
    throw new Error(
      `Trop de lignes (${rows.length}). En SQL : GROUP BY période (mois/jour), SUM(valeur), pas de LIMIT 500 sur le détail.`,
    );
  }

  const dateCol = pickColumn(rows[0]!, opts.date_column, DATE_KEY_HINTS);
  const valueCol = pickColumn(rows[0]!, opts.value_column, VALUE_KEY_HINTS);
  if (!dateCol || !valueCol) {
    throw new Error(
      'Colonnes date/valeur introuvables. En SQL : alias "date" et "value" (ou préciser date_column / value_column).',
    );
  }

  const buckets = new Map<string, number>();
  let skipped = 0;
  for (const row of rows) {
    const rawVal = row[valueCol];
    if (rawVal == null || rawVal === '') {
      skipped++;
      continue;
    }
    const d = parseRowDate(row[dateCol]);
    if (!d) {
      skipped++;
      continue;
    }
    const num =
      typeof rawVal === 'number' ? rawVal : Number(String(rawVal).replace(/,/g, '.'));
    if (!Number.isFinite(num)) {
      skipped++;
      continue;
    }
    const key = periodKey(d, frequency);
    buckets.set(key, (buckets.get(key) ?? 0) + num);
  }

  if (buckets.size < 2) {
    throw new Error(
      `Après agrégation ${frequency} : ${buckets.size} période(s) valide(s). Il en faut au moins 2. Vérifiez le SQL (GROUP BY date, SUM).`,
    );
  }

  let data = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({
      date,
      value: Math.round(value * 100) / 100,
    }));

  const inputRows = rows.length;
  if (inputRows > data.length) {
    notes.push(
      `Agrégation ${frequency} : ${inputRows} ligne(s) SQL → ${data.length} période(s).`,
    );
  }
  if (skipped > 0) {
    notes.push(`${skipped} ligne(s) ignorée(s) (date ou valeur invalide).`);
  }

  if (data.length > FORECAST_MAX_SERIES_POINTS) {
    data = data.slice(-FORECAST_MAX_SERIES_POINTS);
    notes.push(
      `Série réduite aux ${FORECAST_MAX_SERIES_POINTS} dernières périodes.`,
    );
  }

  return { data, notes, input_rows: inputRows };
}

/** Corps JSON complet (comme l’outil n8n Forecasting_API). */
export function parseForecastRequestJson(raw: string): ForecastApiRequest {
  const trimmed = raw.trim();
  if (!trimmed.length) {
    throw new Error('request_json vide.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error('request_json invalide : objet JSON attendu.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('request_json doit être un objet { data, horizon, … }.');
  }
  const o = parsed as Record<string, unknown>;
  if (!Array.isArray(o.data)) {
    throw new Error('request_json.data doit être un tableau.');
  }
  const horizon = Number(o.horizon);
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > FORECAST_MAX_HORIZON) {
    throw new Error(
      `horizon invalide : entier 1–${FORECAST_MAX_HORIZON}.`,
    );
  }
  const freq = o.frequency;
  const frequency =
    freq === 'D' || freq === 'W' || freq === 'M' || freq === 'Y'
      ? freq
      : undefined;
  const modelRaw = o.model;
  const model =
    modelRaw === 'prophet' || modelRaw === 'arima' || modelRaw === 'auto'
      ? modelRaw
      : undefined;

  return {
    data: o.data.map((row, i) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new Error(`data[${i}] : objet attendu.`);
      }
      return row as Record<string, unknown>;
    }),
    horizon,
    frequency,
    model,
    date_column:
      typeof o.date_column === 'string' ? o.date_column : null,
    value_column:
      typeof o.value_column === 'string' ? o.value_column : null,
  };
}

/** @deprecated Utiliser parseForecastRequestJson */
export function parseForecastSeriesJson(raw: string): Record<string, unknown>[] {
  return parseForecastRequestJson(
    JSON.stringify({ data: JSON.parse(raw), horizon: 1 }),
  ).data;
}

export function validateForecastInput(input: ForecastApiRequest): void {
  if (!Array.isArray(input.data) || input.data.length < 2) {
    throw new Error(
      'Au moins 2 points historiques sont requis après agrégation.',
    );
  }
  if (input.data.length > FORECAST_MAX_SERIES_POINTS) {
    throw new Error(
      `Trop de périodes (${input.data.length}) : max ${FORECAST_MAX_SERIES_POINTS}.`,
    );
  }
  const h = input.horizon;
  if (!Number.isInteger(h) || h < 1 || h > FORECAST_MAX_HORIZON) {
    throw new Error(
      `horizon invalide : entier entre 1 et ${FORECAST_MAX_HORIZON}.`,
    );
  }
}

export async function callForecastApi(
  apiUrl: string,
  body: ForecastApiRequest,
): Promise<
  ForecastApiResponse & {
    model_requested: ForecastModel;
    frequency: ForecastFrequency;
    horizon: number;
    methodology: string;
    data_points: number;
    input_rows?: number;
    preparation_notes?: string[];
  }
> {
  const model = body.model ?? 'auto';
  const frequency = body.frequency ?? 'M';

  const { data: cleaned, notes, input_rows } = sanitizeForecastSeries(
    body.data,
    {
      frequency,
      date_column: body.date_column,
      value_column: body.value_column,
    },
  );

  const prepared: ForecastApiRequest = {
    data: cleaned,
    horizon: body.horizon,
    frequency,
    model,
    date_column: 'date',
    value_column: 'value',
  };

  validateForecastInput(prepared);

  const payload = {
    data: prepared.data,
    horizon: prepared.horizon,
    frequency,
    model,
    date_column: 'date',
    value_column: 'value',
  };

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(FORECAST_REQUEST_TIMEOUT_MS),
  });

  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 800);
    try {
      const j = JSON.parse(text) as { detail?: unknown };
      if (j.detail !== undefined) {
        detail = JSON.stringify(j.detail).slice(0, 800);
      }
    } catch {
      /* garde text brut */
    }
    throw new Error(
      `API Forecast HTTP ${res.status}: ${detail || res.statusText}`,
    );
  }

  let parsed: ForecastApiResponse;
  try {
    parsed = JSON.parse(text) as ForecastApiResponse;
  } catch {
    throw new Error('Réponse Forecast API non JSON.');
  }
  if (!Array.isArray(parsed.dates) || !Array.isArray(parsed.forecast)) {
    throw new Error('Réponse Forecast API incomplète (dates / forecast manquants).');
  }

  return {
    ...parsed,
    model_requested: model,
    frequency,
    horizon: body.horizon,
    methodology: forecastMethodologyLabel(model),
    data_points: prepared.data.length,
    input_rows,
    preparation_notes: notes.length ? notes : undefined,
  };
}
