-- Migration 0017: the public-dump view of ref.series_group lists the new `enabled` column
-- (ADR-027, plan T137; AC-DUMP-6 requires the view to list every non-generated table column).
-- Forward-only correction: 0016 added the column and 0011 created the view. The new column is
-- last, matching table order. CREATE OR REPLACE VIEW keeps the owner-rights setting, the grants
-- and the view comment set by 0011. No UPDATE or DELETE of any table.
CREATE OR REPLACE VIEW pubdump.v_ref_series_group AS
SELECT x.source_id,
       x.group_id,
       x.reestimating,
       x.compare_mode,
       x.fixed_decimals,
       x.rel_epsilon,
       x.materiality_abs,
       x.materiality_rel,
       x.snapshot_mode,
       x.max_revised_rows,
       x.edition_ordered,
       x.config_sha256,
       x.enabled
  FROM ref.series_group x;
