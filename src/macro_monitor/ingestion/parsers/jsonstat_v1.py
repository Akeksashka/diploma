"""Eurostat JSON-stat 2.0 parser, version 1 (FROZEN once released: add jsonstat_v2 instead).

Pure function of the bytes and the series filter. Numbers are parsed from text into ``Decimal``
so the published scale survives (JSON floats would lose it).

Series reference: the codes of all non-time dimensions in ``id`` order, joined with ``.``.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from decimal import Decimal, InvalidOperation
from itertools import product
from typing import Any

from macro_monitor.ingestion.base import (
    ParseError,
    ParseOutput,
    RawObject,
    RejectedRow,
    SeriesFilter,
)
from macro_monitor.models.enums import Frequency, SeasonalAdjustment
from macro_monitor.models.periods import PeriodError, parse_period
from macro_monitor.models.types import ParsedObservation, ParsedSeriesMeta

PARSER_VERSION = "1"
PARSER_ID = f"jsonstat_v1@{PARSER_VERSION}"


def _fail(msg: str) -> ParseError:
    return ParseError(f"PARSE-01: {msg}")


def _codes(category: Mapping[str, Any], dim: str) -> list[str]:
    index = category.get("index")
    if isinstance(index, list):
        return [str(c) for c in index]
    if isinstance(index, dict):
        return [str(c) for c, _ in sorted(index.items(), key=lambda kv: int(kv[1]))]
    labels = category.get("label")
    if isinstance(labels, dict) and len(labels) == 1:  # JSON-stat allows a one-category shortcut
        return [str(next(iter(labels)))]
    raise _fail(f"dimension {dim!r} has no category index")


def _scale(value: Decimal) -> int:
    exp = value.as_tuple().exponent
    return max(0, -exp) if isinstance(exp, int) else 0


def _status_for(flags: str | None) -> str:
    """Eurostat flags: f forecast, p provisional, e/s estimated; others keep OBS."""
    if flags:
        if "f" in flags:
            return "PROJ"
        if "p" in flags:
            return "PROV"
        if "e" in flags or "s" in flags:
            return "EST"
    return "OBS"


def _cell(raw: Any) -> tuple[Decimal | None, str | None, bool]:
    """Return (decimal, text, is_numeric) for a value cell."""
    if isinstance(raw, bool):
        return None, str(raw), False
    if isinstance(raw, Decimal):
        return raw, None, True
    if isinstance(raw, str):
        try:
            d = Decimal(raw.strip())
        except InvalidOperation:
            return None, raw, False
        return (d, None, True) if d.is_finite() else (None, raw, False)
    return None, None if raw is None else str(raw), False


def parse(raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
    try:
        doc = json.loads(raw.body, parse_float=Decimal, parse_int=Decimal)
    except (ValueError, UnicodeDecodeError) as exc:
        raise _fail(f"not valid JSON: {exc}") from exc
    if not isinstance(doc, dict) or doc.get("version", "").split(".")[0] != "2":
        raise _fail("not a JSON-stat 2.x document")
    for key in ("id", "size", "dimension", "value"):
        if key not in doc:
            raise _fail(f"missing {key!r}")
    ids: list[str] = [str(i) for i in doc["id"]]
    sizes = [int(s) for s in doc["size"]]
    if len(ids) != len(sizes) or not ids:
        raise _fail("id and size disagree")
    role = doc.get("role") or {}
    time_dim = (role.get("time") or ["time"])[0]
    geo_dim = (role.get("geo") or ["geo"])[0]
    if time_dim not in ids:
        raise _fail(f"time dimension {time_dim!r} missing")
    cats: dict[str, list[str]] = {}
    labels: dict[str, dict[str, str]] = {}
    for dim, size in zip(ids, sizes, strict=True):
        if dim not in doc["dimension"]:
            raise _fail(f"dimension {dim!r} missing")
        cat = doc["dimension"][dim].get("category") or {}
        cats[dim] = _codes(cat, dim)
        labels[dim] = {str(k): str(v) for k, v in (cat.get("label") or {}).items()}
        if len(cats[dim]) != size:
            raise _fail(f"dimension {dim!r} size {size} != {len(cats[dim])} categories")
    for needed in (geo_dim,):
        if needed not in ids:
            raise _fail(f"dimension {needed!r} missing")

    values = doc["value"]
    if isinstance(values, list):
        cells: dict[int, Any] = dict(enumerate(values))
    elif isinstance(values, dict):
        cells = {int(k): v for k, v in values.items()}
    else:
        raise _fail("'value' is neither list nor object")
    status = doc.get("status") or {}
    if isinstance(status, list):
        flags_by_pos: dict[int, str] = {i: str(f) for i, f in enumerate(status) if f}
    else:
        flags_by_pos = {int(k): str(v) for k, v in status.items()}

    other_dims = [d for d in ids if d != time_dim]
    time_codes = cats[time_dim]
    strides: dict[str, int] = {}
    acc = 1
    for dim, size in reversed(list(zip(ids, sizes, strict=True))):
        strides[dim] = acc
        acc *= size
    if acc > 50_000_000:
        raise _fail("implausible cube size")

    dataset_label = str(doc.get("label") or "")
    metas: list[ParsedSeriesMeta] = []
    observations: list[ParsedObservation] = []
    rejected: list[RejectedRow] = []

    combos = product(*(range(sizes[ids.index(d)]) for d in other_dims))
    for combo in sorted(
        combos, key=lambda c: ".".join(cats[d][i] for d, i in zip(other_dims, c, strict=True))
    ):
        picked = {d: cats[d][i] for d, i in zip(other_dims, combo, strict=True)}
        ref = ".".join(picked[d] for d in other_dims)
        if ref not in series_filter.series_refs and not series_filter.discover:
            continue
        mapped = ref in series_filter.series_refs
        base = sum(i * strides[d] for d, i in zip(other_dims, combo, strict=True))
        series_obs: list[ParsedObservation] = []
        freq_code = picked.get("freq")
        for t_i, t_code in enumerate(time_codes):
            pos = base + t_i * strides[time_dim]
            flags = flags_by_pos.get(pos)
            if pos in cells and cells[pos] is not None:
                number, text, numeric = _cell(cells[pos])
                marker = text
            else:
                number, text, numeric = None, None, False
                marker = flags if flags in series_filter.missing_markers else None
                if marker is None:
                    continue  # sparse cube: no observation in this cell
            if not mapped:
                continue
            try:
                bounds = parse_period(t_code)
            except PeriodError as exc:
                rejected.append(RejectedRow(ref, t_code, text, f"PARSE-02: {exc}"))
                continue
            if freq_code is not None and freq_code != bounds.frequency.value:
                rejected.append(
                    RejectedRow(
                        ref, t_code, text, f"PARSE-02: period {t_code!r} is not {freq_code}"
                    )
                )
                continue
            if numeric:
                series_obs.append(
                    ParsedObservation(
                        series_ref=ref,
                        ref_period_start=bounds.start,
                        ref_period_end=bounds.end,
                        value=number,
                        value_status=_status_for(flags),  # type: ignore[arg-type]
                        source_release_at=None,
                        vintage_label=None,
                        source_flags=flags,
                    )
                )
            elif marker is not None and marker in series_filter.missing_markers:
                series_obs.append(
                    ParsedObservation(
                        series_ref=ref,
                        ref_period_start=bounds.start,
                        ref_period_end=bounds.end,
                        value=None,
                        value_status="MISS",
                        source_release_at=None,
                        vintage_label=None,
                        source_flags=marker,
                    )
                )
            else:
                rejected.append(RejectedRow(ref, t_code, text, "PARSE-03: non-numeric value"))
        observations.extend(series_obs)

        scales = [_scale(o.value) for o in series_obs if o.value is not None]
        freq = freq_code
        if freq is None and series_obs:
            freq = parse_period(time_codes[0]).frequency.value
        if freq is None or freq not in {f.value for f in Frequency}:
            freq = freq or ""
        sa = picked.get("s_adj", "NA")
        if sa not in {s.value for s in SeasonalAdjustment}:
            sa = "NA"
        title_parts = [
            labels.get(d, {}).get(picked[d], picked[d]) for d in other_dims if d != "freq"
        ]
        metas.append(
            ParsedSeriesMeta(
                series_ref=ref,
                entity_code=picked[geo_dim],
                frequency=freq,
                unit_code=picked.get("unit", ""),
                unit_mult=0,
                base_period=None,
                price_basis="NA",
                currency_code=None,
                seasonal_adjustment=sa,
                calendar_basis="CAL",
                title=" | ".join([dataset_label, *title_parts]).strip(" |"),
                flow_basis="NA",
                published_decimals=max(scales) if scales else None,
            )
        )
    updated = doc.get("updated")
    return ParseOutput(
        metas=tuple(metas),
        observations=tuple(observations),
        rejected=tuple(rejected),
        source_updated=str(updated) if updated is not None else None,
    )


__all__: Sequence[str] = ["PARSER_ID", "PARSER_VERSION", "parse"]
