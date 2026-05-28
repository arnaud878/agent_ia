import {
  callForecastApi,
  DEFAULT_FORECAST_API_URL,
  forecastMethodologyLabel,
  parseForecastRequestJson,
  sanitizeForecastSeries,
  validateForecastInput,
} from './forecast-api.client';

describe('forecast-api.client', () => {
  it('parseForecastRequestJson accepte le format n8n', () => {
    const req = parseForecastRequestJson(
      JSON.stringify({
        data: [
          { date: '2024-01-01', value: 10 },
          { date: '2024-02-01', value: 20 },
        ],
        horizon: 2,
        frequency: 'M',
        model: 'prophet',
      }),
    );
    expect(req.horizon).toBe(2);
    expect(req.data).toHaveLength(2);
  });

  it('sanitizeForecastSeries agrège des lignes détail en mensuel', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      date: `2024-${String((i % 12) + 1).padStart(2, '0')}-15`,
      ca: 10 + i,
    }));
    const { data, notes, input_rows } = sanitizeForecastSeries(rows, {
      frequency: 'M',
      date_column: 'date',
      value_column: 'ca',
    });
    expect(input_rows).toBe(100);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data.length).toBeLessThan(100);
    expect(notes.some((n) => n.includes('Agrégation'))).toBe(true);
  });

  it('validateForecastInput exige au moins 2 points', () => {
    expect(() =>
      validateForecastInput({
        data: [{ date: '2024-01-01', value: 1 }],
        horizon: 3,
      }),
    ).toThrow(/2/);
  });

  it('forecastMethodologyLabel couvre les modèles', () => {
    expect(forecastMethodologyLabel('prophet')).toContain('Prophet');
    expect(forecastMethodologyLabel('auto')).toContain('automatique');
  });

  it('callForecastApi appelle l’endpoint par défaut', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          dates: ['2024-07-01'],
          forecast: [42],
          lower_bound: [40],
          upper_bound: [44],
        }),
    });
    global.fetch = mockFetch as typeof fetch;

    const out = await callForecastApi(DEFAULT_FORECAST_API_URL, {
      data: [
        { date: '2024-01-01', value: 10 },
        { date: '2024-02-01', value: 12 },
      ],
      horizon: 1,
      model: 'prophet',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      DEFAULT_FORECAST_API_URL,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(out.forecast).toEqual([42]);
    expect(out.model_requested).toBe('prophet');
    expect(out.data_points).toBe(2);
  });
});
