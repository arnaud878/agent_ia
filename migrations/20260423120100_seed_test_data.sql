-- Données de test (réexécutable : purge puis insert)
BEGIN;

DELETE FROM public.vente_carburant;
DELETE FROM public.irradiance;
DELETE FROM public.production;
DELETE FROM public.puissance_installee;

INSERT INTO public.puissance_installee (site_name, puissance_installee, unite)
VALUES
  ('Parc Solaire Nord', 2500, 'kWc'),
  ('Ferme Est', 500, 'kWc');

INSERT INTO public.irradiance (time_of_measure, temp_ambiante, temp_module, irradiance, site_name)
VALUES
  ('2026-01-15 10:00:00', 18.2, 42.0, 850.5, 'Parc Solaire Nord'),
  ('2026-01-15 11:00:00', 19.1, 43.5, 920.0, 'Parc Solaire Nord'),
  ('2026-01-15 10:00:00', 17.5, 40.0, 780.0, 'Ferme Est');

INSERT INTO public.production (
  time_of_measure,
  equipement,
  puissance_active,
  puissance_reactive,
  puissance_apparente,
  cosphi,
  intensite1,
  intensite2,
  intensite3,
  courant_nominal,
  frequence,
  tensionv1,
  tensionv2,
  tensionv3,
  tension12,
  tension23,
  tension31,
  site_name
)
VALUES
  (
    '2026-01-15 10:00:00',
    'Onduleur Central-1',
    1850.0,
    120.0,
    1854.0,
    0.98,
    45.0,
    44.8,
    45.2,
    50.0,
    50.02,
    230.0,
    231.0,
    229.5,
    400.0,
    401.0,
    399.0,
    'Parc Solaire Nord'
  ),
  (
    '2026-01-15 10:15:00',
    'Onduleur Central-1',
    1920.0,
    115.0,
    1923.5,
    0.99,
    46.0,
    45.9,
    46.1,
    50.0,
    50.01,
    232.0,
    232.1,
    231.8,
    402.0,
    402.5,
    401.5,
    'Parc Solaire Nord'
  ),
  (
    '2026-01-15 10:00:00',
    'String-A3',
    380.0,
    25.0,
    381.0,
    0.97,
    9.2,
    9.1,
    9.3,
    10.0,
    50.0,
    228.0,
    228.5,
    227.8,
    395.0,
    396.0,
    394.0,
    'Ferme Est'
  );

INSERT INTO public.vente_carburant (date_vente, station, product_name, volume, unite)
VALUES
  ('2026-01-10', 'Station A - Autoroute', 'Diesel B7', 42.5, 'L'),
  ('2026-01-12', 'Station B - Centre-ville', 'SP95-E10', 35.0, 'L'),
  ('2026-01-14', 'Station A - Autoroute', 'Diesel B7', 60.0, 'L');

COMMIT;
