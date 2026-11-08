-- Migration 0007: export-facing ref views (DDL spec section 2 "Views for the read-only export role", T-DDL-32; plan T17).
-- Forward-only: never edit this file once applied.
-- Owner-rights views: deliberately NOT security_invoker, so mm_reader reads them without any privilege on
-- ref.series, ref.series_group or ref.source (ADR-012; behaviour on Neon UNVERIFIED, covered by the db test).
-- Explicit column lists; published_precision and source_url are config-only fields and have no column.

CREATE VIEW ref.v_source_public AS
SELECT s.source_id, s.provider, s.attribution, s.licence_id, s.publish_site
  FROM ref.source s;

CREATE VIEW ref.v_series_export AS
SELECT se.series_id,
       m.indicator_id,
       m.entity_id,
       se.source_id,
       so.provider AS source_name,
       se.series_key,
       se.frequency,
       se.unit_code,
       se.unit_mult,
       se.base_period,
       se.seasonal_adjustment,
       se.price_basis,
       se.flow_basis,
       se.calendar_basis,
       EXISTS (SELECT 1 FROM ref.inheritance_rule r
                WHERE r.indicator_id = m.indicator_id AND r.entity_id = m.entity_id
                  AND r.valid_from <= current_date
                  AND (r.valid_to IS NULL OR r.valid_to >= current_date)) AS inherited,
       so.attribution AS licence_attribution,
       so.publish_site AS publish,
       g.reestimating
  FROM ref.series_map m
  JOIN ref.indicator i ON i.indicator_id = m.indicator_id AND i.kind = 'indicator'
  JOIN ref.series se ON se.series_id = m.series_id
  JOIN ref.series_group g ON g.source_id = se.source_id AND g.group_id = se.group_id
  JOIN ref.source so ON so.source_id = se.source_id
 WHERE m.role = 'headline'
   AND m.valid_from <= current_date
   AND (m.valid_to IS NULL OR m.valid_to >= current_date);

DO $mm$
DECLARE
  sfx text := CASE WHEN current_database() ~ '^mm_test_[0-9a-f]+$' THEN '_' || substr(current_database(), 9) ELSE '' END;
BEGIN
  EXECUTE format('GRANT SELECT ON ref.v_source_public, ref.v_series_export TO %I', 'mm_reader' || sfx);
END
$mm$;
