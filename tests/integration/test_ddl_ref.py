# ruff: noqa: E501
"""T-DDL-3, 4, 6, 9, 23, 27, 30 and the published_decimals freeze against migration 0001_ref."""

from __future__ import annotations

from collections.abc import Iterator
from typing import TYPE_CHECKING

import psycopg
import pytest
from psycopg import errors

from macro_monitor.storage import migrate

if TYPE_CHECKING:
    from conftest import TestDatabase

pytestmark = pytest.mark.db

_IND_COLS = (
    "indicator_id, name, kind, scope, tier, priority, currency_basis, staleness_class, transform_id, "
    "alert_method, adverse_dir, good_dir, rank_mode, stationarity_class, release_lag_aware"
)


def _indicator(
    conn: psycopg.Connection,
    iid: str,
    *,
    kind: str = "indicator",
    scope: str = "country",
    alert: str = "z",
    good: int = 1,
    rank: str = "monotone_good",
) -> None:
    conn.execute(
        f"INSERT INTO ref.indicator ({_IND_COLS}) VALUES "
        "(%s, %s, %s, %s, 'M', 'core', 'NA', 'ACT120', 'LEVEL', %s, 1, %s, %s, 'stationary', false)",
        [iid, iid, kind, scope, alert, good, rank],
    )


def _series(conn: psycopg.Connection, key: str = "K1", **over: object) -> int:
    cols: dict[str, object] = {
        "source_id": "S",
        "group_id": "G",
        "dataset_id": "D",
        "series_key": key,
        "entity_id": "DEU",
        "title": "t",
        "frequency": "M",
        "unit_code": "PCT",
        "price_basis": "NA",
        "seasonal_adjustment": "SA",
        "first_seen_at": "2026-01-01T00:00:00Z",
    }
    cols.update(over)
    names = ", ".join(cols)
    marks = ", ".join(["%s"] * len(cols))
    row = conn.execute(
        f"INSERT INTO ref.series ({names}) VALUES ({marks}) RETURNING series_id",
        list(cols.values()),
    ).fetchone()
    assert row is not None
    return int(row[0])


@pytest.fixture
def conn(test_database: TestDatabase) -> Iterator[psycopg.Connection]:
    with test_database.connect() as c:
        migrate.migrate(c)
        c.execute(
            "INSERT INTO ref.source VALUES ('S','p','rest','public','public','l','a','x',true)"
        )
        c.execute(
            "INSERT INTO ref.series_group (source_id, group_id, config_sha256) VALUES ('S','G','x')"
        )
        c.execute("INSERT INTO ref.entity VALUES ('DEU','Germany','country',true,false)")
        c.commit()
        yield c


def test_migration_applies_and_seeds_units(conn: psycopg.Connection) -> None:
    assert 1 in migrate.applied(conn)
    units = {r[0] for r in conn.execute("SELECT unit_code FROM ref.unit")}
    assert {
        "PCT",
        "PCT_GDP",
        "IDX",
        "USD",
        "EUR",
        "LCU",
        "INTL_USD_PPP",
        "MONTHS",
        "BALANCE",
    } <= units
    # idempotent
    assert migrate.migrate(conn) == []


# --- T-DDL-3 -------------------------------------------------------------------------------


@pytest.mark.parametrize("col", ["unit_code", "frequency", "seasonal_adjustment", "source_id"])
def test_series_requires_metadata(conn: psycopg.Connection, col: str) -> None:
    with pytest.raises((errors.NotNullViolation, errors.ForeignKeyViolation)):
        _series(conn, **{col: None})
    conn.rollback()


def test_series_rejects_bad_enum_and_unknown_unit(conn: psycopg.Connection) -> None:
    with pytest.raises(errors.CheckViolation):
        _series(conn, frequency="W")
    conn.rollback()
    with pytest.raises(errors.ForeignKeyViolation):
        _series(conn, unit_code="NOPE")
    conn.rollback()
    assert _series(conn) > 0


# --- T-DDL-4 -------------------------------------------------------------------------------


def _map(
    conn: psycopg.Connection, sid: int, frm: str, to: str | None, role: str = "headline"
) -> None:
    conn.execute(
        "INSERT INTO ref.series_map (indicator_id, entity_id, series_id, role, valid_from, valid_to, rationale) "
        "VALUES ('M01','DEU',%s,%s,%s,%s,'r')",
        [sid, role, frm, to],
    )


def test_one_headline_per_window(conn: psycopg.Connection) -> None:
    _indicator(conn, "M01")
    s1, s2 = _series(conn, "A"), _series(conn, "B")
    _map(conn, s1, "2000-01-01", "2010-01-01")
    _map(conn, s2, "2010-01-01", None)  # adjacent windows are fine
    _map(conn, s2, "2000-01-01", None, role="fallback")  # other roles unconstrained
    with pytest.raises(errors.ExclusionViolation):
        _map(conn, s2, "2005-01-01", "2006-01-01")
    conn.rollback()


def test_loader_fallback_flag_skips_exclusion(test_database: TestDatabase) -> None:
    with test_database.connect() as c:
        c.execute("SELECT set_config('mm.headline_exclusion', 'loader', false)")
        c.commit()
        migrate.migrate(c)
        assert c.execute(
            "SELECT count(*) FROM pg_constraint WHERE conname = 'series_map_one_headline'"
        ).fetchone() == (0,)


def test_invalid_flag_value_fails(test_database: TestDatabase) -> None:
    with test_database.connect() as c:
        c.execute("SELECT set_config('mm.headline_exclusion', 'bogus', false)")
        c.commit()
        with pytest.raises(psycopg.errors.RaiseException):
            migrate.migrate(c)


# --- T-DDL-6, 23 ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("col", "value"),
    [
        ("frequency", "Q"),
        ("unit_code", "EUR"),
        ("unit_mult", 3),
        ("base_period", "2021=100"),
        ("price_basis", "REAL"),
        ("currency_code", "EUR"),
        ("seasonal_adjustment", "NSA"),
        ("calendar_basis", "FISCAL"),
        ("flow_basis", "STOCK"),
        ("composition", "FIXED"),
    ],
)
def test_measurement_attributes_immutable(
    conn: psycopg.Connection, col: str, value: object
) -> None:
    sid = _series(conn)
    conn.commit()
    with pytest.raises(errors.RestrictViolation):
        conn.execute(f"UPDATE ref.series SET {col} = %s WHERE series_id = %s", [value, sid])
    conn.rollback()


def test_new_version_and_loading_attributes_ok(conn: psycopg.Connection) -> None:
    sid = _series(conn)
    conn.execute("UPDATE ref.series SET is_active = false, title = 'x' WHERE series_id = %s", [sid])
    new = _series(conn, version=2, supersedes_series_id=sid, flow_basis="STOCK")
    assert new != sid


def test_flow_basis_check(conn: psycopg.Connection) -> None:
    with pytest.raises(errors.CheckViolation):
        _series(conn, flow_basis="FLOW")
    conn.rollback()
    for fb in ("PERIOD_FLOW", "ANNUALISED_RATE", "STOCK", "NA"):
        _series(conn, f"k-{fb}", flow_basis=fb)


# --- published_decimals freeze -------------------------------------------------------------


def test_published_decimals_freeze(conn: psycopg.Connection) -> None:
    sid = _series(conn)
    up = "UPDATE ref.series SET published_decimals = %s WHERE series_id = %s"
    conn.execute(up, [1, sid])  # first set from NULL
    conn.execute(up, [2, sid])  # increase, no observations yet
    conn.commit()
    with pytest.raises(errors.RestrictViolation):
        conn.execute(up, [1, sid])
    conn.rollback()
    with pytest.raises(errors.RestrictViolation):
        conn.execute("UPDATE ref.series SET published_decimals = NULL WHERE series_id = %s", [sid])
    conn.rollback()


def test_published_decimals_increase_needs_event_once_observations_exist(
    conn: psycopg.Connection,
) -> None:
    # stand-in for the curated table (later migration); the trigger references them lazily
    conn.execute(
        "DROP SCHEMA IF EXISTS curated CASCADE"
    )  # real one from a later migration, if present
    conn.execute("CREATE SCHEMA curated")
    conn.execute("CREATE TABLE curated.observation (series_id int)")
    sid = _series(conn)
    conn.execute("UPDATE ref.series SET published_decimals = 1 WHERE series_id = %s", [sid])
    conn.execute("INSERT INTO curated.observation VALUES (%s)", [sid])
    conn.commit()
    up = "UPDATE ref.series SET published_decimals = 2 WHERE series_id = %s"
    with pytest.raises(errors.RestrictViolation):
        conn.execute(up, [sid])
    conn.rollback()
    # event for another kind or another series does not count
    conn.execute(
        "INSERT INTO ops.drift_event (kind, source_id, series_ref) VALUES ('unit','S','K1')"
    )
    with pytest.raises(errors.RestrictViolation):
        conn.execute(up, [sid])
    conn.rollback()
    conn.execute(
        "INSERT INTO ops.drift_event (kind, source_id, series_ref) VALUES ('precision_change','S','K1')"
    )
    conn.execute(up, [sid])
    conn.commit()
    with pytest.raises(errors.RestrictViolation):  # decrease stays rejected, event or not
        conn.execute("UPDATE ref.series SET published_decimals = 0 WHERE series_id = %s", [sid])
    conn.rollback()


# --- T-DDL-9 -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("rank", "good"),
    [("monotone_good", 0), ("descriptive_only", 1), ("target_distance", 1)],
)
def test_rank_mode_good_dir_check(conn: psycopg.Connection, rank: str, good: int) -> None:
    with pytest.raises(errors.CheckViolation):
        _indicator(conn, "M01", rank=rank, good=good)
    conn.rollback()


def test_rank_mode_good_dir_accepted(conn: psycopg.Connection) -> None:
    _indicator(conn, "M01")
    _indicator(conn, "M02", rank="descriptive_only", good=0)
    _indicator(conn, "M03", rank="target_distance", good=0)


def test_indicator_without_rank_mode_fails(conn: psycopg.Connection) -> None:
    cols = _IND_COLS.replace(" rank_mode,", "")
    with pytest.raises(errors.NotNullViolation):
        conn.execute(
            f"INSERT INTO ref.indicator ({cols}) VALUES "
            "('M01','n','indicator','country','M','core','NA','ACT120','LEVEL','z',1,1,'stationary',false)"
        )
    conn.rollback()


def test_display_dir(conn: psycopg.Connection) -> None:
    _indicator(conn, "M01", rank="descriptive_only", good=0)
    conn.execute("UPDATE ref.indicator SET display_dir = 1 WHERE indicator_id = 'M01'")
    with pytest.raises(errors.CheckViolation):
        conn.execute("UPDATE ref.indicator SET display_dir = 2 WHERE indicator_id = 'M01'")
    conn.rollback()


def test_input_indicator_rules(conn: psycopg.Connection) -> None:
    _indicator(conn, "X01", kind="input", rank="descriptive_only", good=0, alert="none")
    assert conn.execute(
        "SELECT is_support FROM ref.indicator WHERE indicator_id = 'X01'"
    ).fetchone() == (True,)
    _indicator(conn, "M01")
    assert conn.execute(
        "SELECT is_support FROM ref.indicator WHERE indicator_id = 'M01'"
    ).fetchone() == (False,)
    conn.commit()
    with pytest.raises(errors.CheckViolation):  # input with a ranked mode
        _indicator(conn, "X02", kind="input")
    conn.rollback()
    with pytest.raises(errors.CheckViolation):  # input with an alert method
        _indicator(conn, "X02", kind="input", rank="descriptive_only", good=0, alert="z")
    conn.rollback()
    conn.execute("INSERT INTO ref.domain VALUES ('growth','Growth',true,0.5,NULL)")
    with pytest.raises(errors.CheckViolation):  # input with a domain row
        conn.execute("INSERT INTO ref.indicator_domain VALUES ('X01','growth',false)")
    conn.rollback()


def test_indicator_domain_ranked_rules(conn: psycopg.Connection) -> None:
    conn.execute(
        "INSERT INTO ref.domain VALUES ('growth','G',true,0.5,NULL), ('agri','A',false,0.5,NULL)"
    )
    _indicator(conn, "M01")
    _indicator(conn, "M02", rank="descriptive_only", good=0)
    conn.execute(
        "INSERT INTO ref.indicator_domain VALUES ('M01','growth',true), ('M01','agri',false)"
    )
    conn.commit()
    for ind, dom in (("M01", "agri"),):
        with pytest.raises(errors.CheckViolation):
            conn.execute(
                "UPDATE ref.indicator_domain SET is_ranked = true WHERE indicator_id=%s AND domain_id=%s",
                [ind, dom],
            )
        conn.rollback()
    with pytest.raises(errors.CheckViolation):
        conn.execute("INSERT INTO ref.indicator_domain VALUES ('M02','growth',true)")
    conn.rollback()


def test_global_indicator_must_be_unranked(conn: psycopg.Connection) -> None:
    with pytest.raises(errors.CheckViolation):
        _indicator(conn, "G01", scope="global")
    conn.rollback()
    _indicator(conn, "G01", scope="global", rank="descriptive_only", good=0)


def test_entity_global_rules(conn: psycopg.Connection) -> None:
    with pytest.raises(errors.CheckViolation):  # global must be an aggregate
        conn.execute("INSERT INTO ref.entity VALUES ('XX','X','country',false,true)")
    conn.rollback()
    with pytest.raises(errors.CheckViolation):  # aggregates are unranked
        conn.execute("INSERT INTO ref.entity VALUES ('WLD','World','aggregate',true,true)")
    conn.rollback()
    conn.execute("INSERT INTO ref.entity VALUES ('WLD','World','aggregate',false,true)")


def test_global_translation_rules(conn: psycopg.Connection) -> None:
    _indicator(conn, "G01", scope="global", rank="descriptive_only", good=0)
    _indicator(conn, "X01", kind="input", rank="descriptive_only", good=0, alert="none")
    _indicator(conn, "M01")
    ins = (
        "INSERT INTO ref.global_translation (indicator_id, entity_id, method, weight_input_id, rationale) "
        "VALUES ('G01','DEU',%s,%s,'r')"
    )
    conn.commit()
    with pytest.raises(errors.CheckViolation):
        conn.execute(ins, ["weighted_by_input", None])
    conn.rollback()
    with pytest.raises(errors.CheckViolation):  # weight input must be an input indicator
        conn.execute(ins, ["weighted_by_input", "M01"])
    conn.rollback()
    conn.execute(ins, ["weighted_by_input", "X01"])


def test_annualised_policy_only_fail(conn: psycopg.Connection) -> None:
    _indicator(conn, "M01")
    _indicator(conn, "X01", kind="input", rank="descriptive_only", good=0, alert="none")
    ins = (
        "INSERT INTO ref.indicator_input (indicator_id, input_id, usage, currency_match{}) "
        "VALUES ('M01','X01','denominator_gdp_lcu','lcu'{})"
    )
    conn.commit()
    for bad in ("latest_single", "other"):
        with pytest.raises(errors.CheckViolation):
            conn.execute(ins.format(", annualised_policy", ", %s"), [bad])
        conn.rollback()
    conn.execute(ins.format("", ""))
    assert conn.execute("SELECT annualised_policy FROM ref.indicator_input").fetchone() == ("fail",)
    with pytest.raises(errors.CheckViolation):  # input_id must be an input indicator
        conn.execute(
            "INSERT INTO ref.indicator_input (indicator_id, input_id, usage, currency_match) "
            "VALUES ('M01','M01','u','lcu')"
        )
    conn.rollback()


# --- T-DDL-27 ------------------------------------------------------------------------------


def test_adr014_columns_no_default_and_checked(conn: psycopg.Connection) -> None:
    for omit in ("stationarity_class,", "release_lag_aware"):
        cols = _IND_COLS.replace(omit, "").rstrip(", ")
        vals = [
            "'M01'",
            "'n'",
            "'indicator'",
            "'country'",
            "'M'",
            "'core'",
            "'NA'",
            "'ACT120'",
            "'LEVEL'",
            "'z'",
            "1",
            "1",
            "'monotone_good'",
            "'stationary'",
            "false",
        ]
        names = [c.strip() for c in _IND_COLS.split(",")]
        keep = [v for n, v in zip(names, vals, strict=True) if n in cols]
        with pytest.raises(errors.NotNullViolation):
            conn.execute(f"INSERT INTO ref.indicator ({cols}) VALUES ({', '.join(keep)})")
        conn.rollback()
    _indicator(conn, "M01")
    conn.commit()
    with pytest.raises(errors.CheckViolation):
        conn.execute(
            "UPDATE ref.indicator SET stationarity_class = 'seasonal' WHERE indicator_id = 'M01'"
        )
    conn.rollback()
    for v in ("stationary", "trending_level", "rate_of_change"):
        conn.execute(
            "UPDATE ref.indicator SET stationarity_class = %s WHERE indicator_id = 'M01'", [v]
        )


# --- T-DDL-30 ------------------------------------------------------------------------------


def test_series_group_checks(conn: psycopg.Connection) -> None:
    ins = "INSERT INTO ref.series_group (source_id, group_id, config_sha256, {}) VALUES ('S', %s, 'x', {})"
    with pytest.raises(errors.CheckViolation):
        conn.execute(ins.format("edition_ordered, reestimating", "true, true"), ["g1"])
    conn.rollback()
    conn.execute(ins.format("edition_ordered, reestimating", "true, false"), ["g2"])
    with pytest.raises(errors.CheckViolation):  # snapshot_mode needs reestimating
        conn.execute(ins.format("snapshot_mode", "'diff_above_tol'"), ["g3"])
    conn.rollback()
    conn.execute(ins.format("snapshot_mode, reestimating", "'diff_above_tol', true"), ["g4"])
    with pytest.raises(errors.CheckViolation):  # fixed_decimals compare needs fixed_decimals
        conn.execute(ins.format("compare_mode", "'fixed_decimals'"), ["g5"])
    conn.rollback()


# --- T-DDL-32 (export views) ---------------------------------------------------------------

_SERIES_EXPORT_COLS = [
    "series_id", "indicator_id", "entity_id", "source_id", "source_name", "series_key", "frequency",
    "unit_code", "unit_mult", "base_period", "seasonal_adjustment", "price_basis", "flow_basis",
    "calendar_basis", "inherited", "licence_attribution", "publish", "reestimating",
]  # fmt: skip


def _view_cols(conn: psycopg.Connection, view: str) -> list[str]:
    rows = conn.execute(
        "SELECT a.attname FROM pg_attribute a WHERE a.attrelid = %s::regclass "
        "AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum",
        [view],
    ).fetchall()
    return [r[0] for r in rows]


def test_export_views_exact_columns(conn: psycopg.Connection) -> None:
    assert _view_cols(conn, "ref.v_series_export") == _SERIES_EXPORT_COLS
    assert _view_cols(conn, "ref.v_source_public") == [
        "source_id", "provider", "attribution", "licence_id", "publish_site",
    ]  # fmt: skip


def test_export_view_rows(conn: psycopg.Connection) -> None:
    conn.execute(
        "INSERT INTO ref.source VALUES ('W','pw','rest','public','withheld','l','aw','x',true)"
    )
    conn.execute(
        "INSERT INTO ref.source VALUES ('E','pe','rest','public','public','l','ae','x',true)"
    )
    conn.execute(
        "INSERT INTO ref.series_group (source_id, group_id, config_sha256, edition_ordered) "
        "VALUES ('E','WEO','x',true)"
    )
    conn.execute(
        "INSERT INTO ref.series_group (source_id, group_id, config_sha256) VALUES ('W','G','x')"
    )
    conn.execute(
        "INSERT INTO ref.series_group (source_id, group_id, reestimating, config_sha256) VALUES ('E','RE',true,'x')"
    )
    conn.execute("INSERT INTO ref.entity VALUES ('EA','Euro area','aggregate',false,false)")
    for iid in ("M01", "M02", "M03"):
        _indicator(conn, iid)
    _indicator(conn, "X01", kind="input", rank="descriptive_only", good=0, alert="none")
    s_pub = _series(conn, "A")
    s_wh = _series(conn, "B", source_id="W")
    s_in = _series(conn, "C")
    s_cmp = _series(conn, "D")
    s_weo = _series(conn, "E", source_id="E", group_id="WEO")
    s_re = _series(conn, "F", source_id="E", group_id="RE", entity_id="EA")
    ins = (
        "INSERT INTO ref.series_map (indicator_id, entity_id, series_id, role, rationale) "
        "VALUES (%s, %s, %s, %s, 'r')"
    )
    conn.execute(ins, ["M01", "DEU", s_pub, "headline"])
    conn.execute(ins, ["M02", "DEU", s_wh, "headline"])
    conn.execute(ins, ["X01", "DEU", s_in, "headline"])
    conn.execute(ins, ["M01", "DEU", s_cmp, "comparison"])
    conn.execute(ins, ["M03", "DEU", s_weo, "headline"])
    conn.execute(ins, ["M03", "EA", s_re, "headline"])
    conn.execute(
        "INSERT INTO ref.inheritance_rule VALUES ('M03','EA','EA','2000-01-01',NULL), "
        "('M01','DEU','EA','2000-01-01','2000-12-31')"
    )
    conn.commit()
    rows = {
        (r[0], r[1]): r
        for r in conn.execute(
            "SELECT series_id, entity_id, indicator_id, publish, reestimating, inherited "
            "FROM ref.v_series_export"
        ).fetchall()
    }
    assert set(rows) == {(s_pub, "DEU"), (s_wh, "DEU"), (s_weo, "DEU"), (s_re, "EA")}
    assert rows[(s_wh, "DEU")][3] == "withheld"
    assert rows[(s_pub, "DEU")][3] == "public"
    assert rows[(s_re, "EA")][4] is True
    assert rows[(s_weo, "DEU")][4] is False
    # inherited exactly for pairs with a currently valid rule (M01/DEU rule has expired)
    assert {k: v[5] for k, v in rows.items()} == {
        (s_pub, "DEU"): False, (s_wh, "DEU"): False, (s_weo, "DEU"): False, (s_re, "EA"): True,
    }  # fmt: skip


def test_export_views_owner_rights_for_reader(test_database: TestDatabase) -> None:
    with test_database.connect() as c:
        migrate.migrate(c)
        c.commit()
        assert c.execute(
            "SELECT bool_or(coalesce(reloptions::text, '') LIKE '%security_invoker%') FROM pg_class "
            "WHERE oid IN ('ref.v_series_export'::regclass, 'ref.v_source_public'::regclass)"
        ).fetchone() == (False,)
        c.execute(
            "INSERT INTO ref.source VALUES ('S','p','rest','public','public','l','a','x',true)"
        )
        c.commit()
    with test_database.connect("mm_reader") as r:
        assert r.execute("SELECT source_id FROM ref.v_source_public").fetchall() == [("S",)]
        assert r.execute("SELECT count(*) FROM ref.v_series_export").fetchone() == (0,)
        r.rollback()
        for tbl in ("ref.series", "ref.series_group", "ref.source"):
            with pytest.raises(errors.InsufficientPrivilege):
                r.execute(f"SELECT 1 FROM {tbl}")
            r.rollback()
