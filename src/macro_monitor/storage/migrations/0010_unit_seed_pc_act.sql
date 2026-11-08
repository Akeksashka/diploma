-- Migration 0010: reference-data seed only (orchestrator decision, Eurostat unit gap, plan T27).
-- Eurostat unemployment series (une_rt_m, unit PC_ACT) need this unit before first-sight series
-- creation (ADR-018) can pass the ref.unit precondition. No tables, views or grants change.
INSERT INTO ref.unit (unit_code, dimension, description) VALUES
  ('PC_ACT', 'ratio', 'Percent of active population (Eurostat)')
ON CONFLICT DO NOTHING;
