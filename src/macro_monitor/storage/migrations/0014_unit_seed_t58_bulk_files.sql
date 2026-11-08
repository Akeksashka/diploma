-- Migration 0014: reference-data seed only (plan T58, bulk-file connectors; precedents 0010, 0013).
-- World Bank Pink Sheet prices (USD_BBL, USD_MT, USD_MMBTU) and the AMECO output gap
-- (PCT_POT_GDP, percent of potential GDP) need these units before first-sight series creation
-- (ADR-018) can pass the ref.unit precondition. No tables, views or grants change.
INSERT INTO ref.unit (unit_code, dimension, description) VALUES
  ('USD_BBL', 'currency', 'US dollars per barrel'),
  ('USD_MT', 'currency', 'US dollars per metric tonne'),
  ('USD_MMBTU', 'currency', 'US dollars per million British thermal units'),
  ('PCT_POT_GDP', 'ratio', 'Percent of potential GDP')
ON CONFLICT DO NOTHING;
