-- Migration 0013: reference-data seed only (plan T53, Eurostat unit gap; precedent migration 0010).
-- Eurostat sts_inpr_m / sts_trtu_m (I21), prc_hicp_minr (I25), gov_10q_ggdebt (PC_GDP) and the
-- balance-of-payments style MIO_EUR need these units before first-sight series creation
-- (ADR-018) can pass the ref.unit precondition. No tables, views or grants change.
INSERT INTO ref.unit (unit_code, dimension, description) VALUES
  ('I21', 'index', 'Index, 2021=100 (Eurostat)'),
  ('I25', 'index', 'Index, 2025=100 (Eurostat)'),
  ('PC_GDP', 'ratio', 'Percent of GDP (Eurostat)'),
  ('MIO_EUR', 'currency', 'Million euro (Eurostat)')
ON CONFLICT DO NOTHING;
