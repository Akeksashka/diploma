"""Pandera contracts on staged rows (PARSE-01..04, META-01; ADR-007, ADR-016).

This is the only module in the project that creates DataFrames. A frame is built from the
staged rows at the validation boundary, validated lazily, and dropped; callers receive the plain
``ContractReport`` and never a frame (AC-DEP-1).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

import pandas as pd
import pandera.pandas as pa

from macro_monitor.models.enums import (
    CalendarBasis,
    Frequency,
    SeasonalAdjustment,
    ValueStatus,
)
from macro_monitor.models.periods import PeriodError, check_bounds
from macro_monitor.models.types import ParsedObservation, ParsedSeriesMeta

OBSERVATION_COLUMNS = (
    "series_ref",
    "ref_period_start",
    "ref_period_end",
    "value",
    "value_status",
    "source_flags",
)
META_COLUMNS = ("series_ref", "entity_code", "frequency", "unit_code", "seasonal_adjustment")

# Parsers never stage DEL (tombstones are made by the loader).
STAGED_STATUSES = frozenset(s.value for s in ValueStatus if s is not ValueStatus.DEL)
_FREQUENCIES = frozenset(f.value for f in Frequency)
_SA_CODES = frozenset(s.value for s in SeasonalAdjustment)

_NOT_NULLABLE = "not_nullable"
_MISSING_COLUMN = "column_in_dataframe"


@dataclass(frozen=True)
class ContractFailure:
    """One violated contract on one staged row (``row`` is the position in the input)."""

    check_id: str
    row: int | None
    series_ref: str | None
    ref_period: str | None
    column: str | None
    raw_value: str | None
    message: str


@dataclass(frozen=True)
class ContractReport:
    n_rows: int
    failures: tuple[ContractFailure, ...] = ()

    def for_check(self, check_id: str) -> tuple[ContractFailure, ...]:
        return tuple(f for f in self.failures if f.check_id == check_id)


def observation_rows(observations: Iterable[ParsedObservation]) -> list[dict[str, object]]:
    """Staged-row view of parsed observations (plain dicts)."""
    return [
        {
            "series_ref": o.series_ref,
            "ref_period_start": o.ref_period_start,
            "ref_period_end": o.ref_period_end,
            "value": o.value,
            "value_status": o.value_status,
            "source_flags": o.source_flags,
        }
        for o in observations
    ]


def meta_rows(metas: Iterable[ParsedSeriesMeta]) -> list[dict[str, object]]:
    return [
        {
            "series_ref": m.series_ref,
            "entity_code": m.entity_code,
            "frequency": m.frequency,
            "unit_code": m.unit_code,
            "seasonal_adjustment": m.seasonal_adjustment,
        }
        for m in metas
    ]


# ---------------------------------------------------------------------------------------
# element predicates (applied per cell; a failing cell yields a failure case with its index)
# ---------------------------------------------------------------------------------------


def _is_text(v: object) -> bool:
    return isinstance(v, str) and v.strip() != ""


def _is_date(v: object) -> bool:
    return isinstance(v, date)


def _is_finite_decimal_or_null(v: object) -> bool:
    if _is_null(v):
        return True
    if isinstance(v, bool) or not isinstance(v, int | Decimal):
        return False
    return Decimal(v).is_finite()


def _is_null(v: object) -> bool:
    if v is None or v is pd.NA or v is pd.NaT:
        return True
    return isinstance(v, float) and math.isnan(v)


def _element(pred: Callable[[Any], bool], name: str) -> pa.Check:
    return pa.Check(lambda s: s.map(pred).astype(bool), name=name, element_wise=False)


def _observation_schema(
    frequencies: Mapping[str, str],
    calendar_bases: Mapping[str, str],
    missing_markers: frozenset[str] | None,
) -> pa.DataFrameSchema:
    def period_ok(df: pd.DataFrame) -> pd.Series[bool]:
        out: list[bool] = []
        for ref, start, end in zip(
            df["series_ref"], df["ref_period_start"], df["ref_period_end"], strict=False
        ):
            if not (isinstance(start, date) and isinstance(end, date)):
                out.append(False)
                continue
            freq = frequencies.get(ref) if isinstance(ref, str) else None
            try:
                if freq is None:
                    check_bounds_ok = end >= start
                else:
                    basis = CalendarBasis(calendar_bases.get(ref, CalendarBasis.CAL.value))
                    check_bounds(Frequency(freq), basis, start, end)
                    check_bounds_ok = True
            except (PeriodError, ValueError):
                check_bounds_ok = False
            out.append(check_bounds_ok)
        return pd.Series(out, index=df.index, dtype=bool)

    def miss_consistent(df: pd.DataFrame) -> pd.Series[bool]:
        out: list[bool] = []
        for value, status, flags in zip(
            df["value"], df["value_status"], df["source_flags"], strict=False
        ):
            if status == ValueStatus.MISS.value:
                ok = _is_null(value) and _is_text(flags)
                if ok and missing_markers is not None:
                    ok = str(flags) in missing_markers
            else:
                ok = not _is_null(value)
            out.append(ok)
        return pd.Series(out, index=df.index, dtype=bool)

    def no_duplicates(df: pd.DataFrame) -> pd.Series[bool]:
        dup = df.duplicated(subset=["series_ref", "ref_period_start"], keep=False)
        return ~dup

    cols: dict[str, pa.Column] = {
        "series_ref": pa.Column(object, _element(_is_text, "PARSE-01"), nullable=False),
        "ref_period_start": pa.Column(object, _element(_is_date, "PARSE-02"), nullable=False),
        "ref_period_end": pa.Column(object, _element(_is_date, "PARSE-02"), nullable=False),
        "value": pa.Column(object, _element(_is_finite_decimal_or_null, "PARSE-03"), nullable=True),
        "value_status": pa.Column(
            object, _element(lambda v: v in STAGED_STATUSES, "PARSE-01"), nullable=False
        ),
        "source_flags": pa.Column(object, nullable=True, required=False),
    }
    return pa.DataFrameSchema(
        cols,
        checks=[
            pa.Check(period_ok, name="PARSE-02", element_wise=False),
            pa.Check(miss_consistent, name="PARSE-03", element_wise=False),
            pa.Check(no_duplicates, name="PARSE-04", element_wise=False),
        ],
        strict=False,
    )


def _meta_schema(unit_codes: frozenset[str] | None) -> pa.DataFrameSchema:
    def code_in(allowed: frozenset[str] | None) -> Callable[[Any], bool]:
        return lambda v: _is_text(v) and (allowed is None or v in allowed)

    return pa.DataFrameSchema(
        {
            "series_ref": pa.Column(object, _element(_is_text, "META-01"), nullable=False),
            "entity_code": pa.Column(object, _element(code_in(None), "META-01"), nullable=False),
            "frequency": pa.Column(
                object, _element(code_in(_FREQUENCIES), "META-01"), nullable=False
            ),
            "unit_code": pa.Column(
                object, _element(code_in(unit_codes), "META-01"), nullable=False
            ),
            "seasonal_adjustment": pa.Column(
                object, _element(code_in(_SA_CODES), "META-01"), nullable=False
            ),
        },
        strict=False,
    )


# ---------------------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------------------


def _str(v: object) -> str | None:
    return None if _is_null(v) else str(v)


def _label(v: object) -> str | None:
    return None if _is_null(v) else (v.isoformat() if isinstance(v, date) else str(v))


def _run(
    schema: pa.DataFrameSchema,
    rows: Sequence[Mapping[str, object]],
    columns: Sequence[str],
    default_check: str,
    period_cols: tuple[str, ...] = (),
) -> ContractReport:
    frame = pd.DataFrame(list(rows), columns=None if rows else list(columns))
    frame = frame.astype(object).where(frame.notna(), None)
    present = set(frame.columns)
    failures: list[ContractFailure] = []
    required = [c for c, col in schema.columns.items() if col.required]
    missing = [c for c in required if c not in present]
    for c in missing:
        failures.append(
            ContractFailure(default_check, None, None, None, c, None, f"column {c!r} missing")
        )
    if missing:  # PARSE-01 / META-01: nothing else can be judged without the columns
        return ContractReport(len(rows), tuple(failures))
    try:
        schema.validate(frame, lazy=True)
    except pa.errors.SchemaErrors as exc:
        cases = exc.failure_cases
        seen: set[tuple[str, int | None]] = set()  # frame-wide checks report once per column
        for _, case in cases.iterrows():
            name = str(case["check"])
            check_id = name if name[:3] in ("PAR", "MET") else default_check
            idx = case["index"]
            row = None if _is_null(idx) else int(idx)
            if row is not None:
                if (check_id, row) in seen:
                    continue
                seen.add((check_id, row))
            src = rows[row] if row is not None and 0 <= row < len(rows) else {}
            period = next((_label(src.get(c)) for c in period_cols if c in src), None)
            message = f"{name}: {case['column']}" if not _is_null(case["column"]) else name
            if name == _NOT_NULLABLE:
                message = f"null in required column {case['column']}"
            failures.append(
                ContractFailure(
                    check_id,
                    row,
                    _str(src.get("series_ref")),
                    period,
                    _str(case["column"]),
                    _str(src.get("value")) if "value" in src else None,
                    message,
                )
            )
    return ContractReport(len(rows), tuple(failures))


def validate_observation_rows(
    rows: Sequence[Mapping[str, object]],
    *,
    frequencies: Mapping[str, str] | None = None,
    calendar_bases: Mapping[str, str] | None = None,
    missing_markers: frozenset[str] | None = None,
) -> ContractReport:
    """PARSE-01..04 on staged observation rows.

    ``frequencies`` maps series_ref to its frequency code (PARSE-02 period/frequency match;
    absent series are only checked for end >= start). ``missing_markers``, when given, restricts
    the ``source_flags`` of ``MISS`` rows to the declared markers (PARSE-03).
    """
    schema = _observation_schema(frequencies or {}, calendar_bases or {}, missing_markers)
    return _run(schema, rows, OBSERVATION_COLUMNS, "PARSE-01", ("ref_period_start",))


def validate_meta_rows(
    rows: Sequence[Mapping[str, object]],
    *,
    unit_codes: frozenset[str] | None = None,
) -> ContractReport:
    """META-01: entity, frequency, unit and seasonal adjustment non-null and in their code lists.

    Entity codes are only required non-null here; their resolution is META-03 (``checks``).
    """
    return _run(_meta_schema(unit_codes), rows, META_COLUMNS, "META-01")
