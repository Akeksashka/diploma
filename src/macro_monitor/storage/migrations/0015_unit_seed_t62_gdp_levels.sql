-- Migration 0015: reference-data seed only (plan T62; precedents 0010, 0013, 0014).
-- Eurostat quarterly national accounts (namq_10_gdp) report current-price GDP in million national
-- currency (CP_MNAC) or million euro (CP_MEUR); X01 first-sight series creation (ADR-018) needs
-- both units in ref.unit. No tables, views or grants change.
INSERT INTO ref.unit (unit_code, dimension, description) VALUES
  ('CP_MNAC', 'currency', 'Current prices, million units of national currency (Eurostat)'),
  ('CP_MEUR', 'currency', 'Current prices, million euro (Eurostat)')
ON CONFLICT DO NOTHING;
