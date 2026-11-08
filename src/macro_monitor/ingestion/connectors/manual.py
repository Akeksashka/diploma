"""Manual connector (T59, ADR-005): human-downloaded files in ``manual_inbox/``.

A file ``manual_inbox/<source_id>/<YYYY-MM>/<file>`` needs a sidecar ``<file>.meta.yaml``. The
object is stamped with the actual import time (``fetched_at``, I-ING-3: when the bytes were
obtained); the publication date of the edition travels in ``edition_date``. Imports go through the
same ``record_fetch`` / ``stage_output`` path and the same loader queue and lock as scheduled
loads; nothing here writes to ``curated``.
"""

from __future__ import annotations

import logging
import mimetypes
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Literal

import psycopg
import yaml

from macro_monitor.ingestion import archive, registry
from macro_monitor.ingestion.base import (
    GroupConfig,
    Mode,
    ParseOutput,
    RawObject,
    SeriesFilter,
    StateStore,
)
from macro_monitor.ingestion.connectors.sdmx import request_key
from macro_monitor.ingestion.fetch import stage_output
from macro_monitor.ingestion.http import HttpClient
from macro_monitor.models.types import FetchResult, RequestSpec

log = logging.getLogger(__name__)

INBOX_DIR = "manual_inbox"
SIDECAR_SUFFIX = ".meta.yaml"
IMPORT_LABEL = "archive_import"
URL_SCHEME = "manual://"
SIDECAR_REQUIRED_DEFAULT = ("source_url", "downloaded_on", "downloaded_by", "edition_label")
SIDECAR_KNOWN = frozenset(
    {
        "source_url",
        "downloaded_on",
        "downloaded_by",
        "edition_label",
        "edition_date",
        "licence_note",
        "import_label",
    }
)
_SOURCE = re.compile(r"[a-z0-9_]+")
_MONTH = re.compile(r"[0-9]{4}-(0[1-9]|1[0-2])")
_FILE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")


class ManualInboxError(Exception):
    """A path or sidecar violates the inbox contract (CLI exit 20)."""


@dataclass(frozen=True)
class Sidecar:
    source_url: str
    downloaded_on: date
    downloaded_by: str
    edition_label: str | None
    edition_date: date | None
    import_label: str | None
    licence_note: str | None = None


def _as_date(value: object, key: str) -> date:
    if isinstance(value, datetime):
        raise ManualInboxError(f"sidecar {key} must be a date (YYYY-MM-DD)")
    if isinstance(value, date):
        return value
    if isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        try:
            return date.fromisoformat(value)
        except ValueError:
            pass
    raise ManualInboxError(f"sidecar {key} must be a date (YYYY-MM-DD)")


def validate_sidecar(
    data: object,
    *,
    required: tuple[str, ...] = SIDECAR_REQUIRED_DEFAULT,
    edition_ordered: bool = False,
) -> Sidecar:
    """Rule 18: an ``edition_ordered`` group needs ``edition_label`` and ``edition_date``;
    ``import_label`` may only be ``archive_import``; unknown keys are refused."""
    if not isinstance(data, Mapping):
        raise ManualInboxError("sidecar must be a YAML mapping")
    unknown = sorted(str(k) for k in data if k not in SIDECAR_KNOWN)
    if unknown:
        raise ManualInboxError(f"sidecar has unknown keys: {', '.join(unknown)}")
    need = set(required) | set(SIDECAR_REQUIRED_DEFAULT)
    if edition_ordered:
        need |= {"edition_label", "edition_date"}
    missing = sorted(k for k in need if data.get(k) in (None, ""))
    if missing:
        raise ManualInboxError(f"sidecar is missing required keys: {', '.join(missing)}")
    label = data.get("import_label")
    if label is not None and label != IMPORT_LABEL:
        raise ManualInboxError(f"sidecar import_label must be {IMPORT_LABEL!r} when present")
    for key in ("source_url", "downloaded_by", "edition_label", "licence_note"):
        if data.get(key) is not None and not isinstance(data[key], str):
            raise ManualInboxError(f"sidecar {key} must be text")
    edition_date = data.get("edition_date")
    return Sidecar(
        source_url=str(data["source_url"]),
        downloaded_on=_as_date(data["downloaded_on"], "downloaded_on"),
        downloaded_by=str(data["downloaded_by"]),
        edition_label=data.get("edition_label"),
        edition_date=None if edition_date is None else _as_date(edition_date, "edition_date"),
        import_label=label,
        licence_note=data.get("licence_note"),
    )


def read_sidecar(
    path: Path, *, required: tuple[str, ...] = SIDECAR_REQUIRED_DEFAULT, edition_ordered: bool
) -> Sidecar:
    side = path.with_name(path.name + SIDECAR_SUFFIX)
    if not side.is_file():
        raise ManualInboxError(f"sidecar {side.name} not found")
    try:
        data = yaml.safe_load(side.read_text(encoding="utf-8"))
    except (yaml.YAMLError, UnicodeDecodeError) as exc:
        raise ManualInboxError(f"sidecar {side.name} is not valid YAML") from exc
    return validate_sidecar(data, required=required, edition_ordered=edition_ordered)


def resolve_inbox_file(root: Path, source_id: str, rel: str) -> Path:
    """Path allow-list: ``manual_inbox/<source_id>/<YYYY-MM>/<file>``, no links, no traversal."""
    if _SOURCE.fullmatch(source_id) is None:
        raise ManualInboxError("invalid source id")
    parts = rel.split("/")
    if (
        len(parts) != 4
        or parts[0] != INBOX_DIR
        or parts[1] != source_id
        or _MONTH.fullmatch(parts[2]) is None
        or _FILE.fullmatch(parts[3]) is None
        or parts[3].endswith(SIDECAR_SUFFIX)
    ):
        raise ManualInboxError(f"path must be {INBOX_DIR}/{source_id}/<YYYY-MM>/<file>")
    path = root / rel
    if any(p.is_symlink() for p in (path, *path.parents) if root in p.parents):
        raise ManualInboxError("symbolic links are not allowed in the inbox")
    if not path.is_file():
        raise ManualInboxError(f"inbox file {rel} does not exist")
    return path


def list_inbox_files(root: Path, source_id: str) -> list[str]:
    """Relative paths of all data files (sidecars excluded) of a source, sorted."""
    base = root / INBOX_DIR / source_id
    if not base.is_dir():
        return []
    out: list[str] = []
    for month in sorted(base.iterdir()):
        if month.is_dir() and _MONTH.fullmatch(month.name):
            for f in sorted(month.iterdir()):
                if f.is_file() and not f.name.endswith(SIDECAR_SUFFIX) and f.name != ".gitkeep":
                    out.append(f"{INBOX_DIR}/{source_id}/{month.name}/{f.name}")
    return out


def _rel_of(spec_url: str) -> str:
    if not spec_url.startswith(URL_SCHEME):
        raise ManualInboxError("not a manual request")
    return f"{INBOX_DIR}/{spec_url[len(URL_SCHEME) :]}"


class ManualConnector:
    """Three-step connector over the inbox: plan lists files, fetch reads one, parse delegates."""

    def __init__(
        self, root: Path, *, clock: Callable[[], datetime] = lambda: datetime.now(UTC)
    ) -> None:
        self.source_id = ""
        self._root = root
        self._clock = clock

    def spec_for(self, group: GroupConfig, rel: str) -> RequestSpec:
        url = URL_SCHEME + rel[len(INBOX_DIR) + 1 :]
        return RequestSpec(
            source_id=group.source_id,
            group_id=group.group_id,
            method="GET",
            url=url,
            params={},
            headers={},
            request_key=request_key("GET", url, {}),
            fetch_mode="full",
            expect_scope=group.fetch_scope,
        )

    def plan(self, group: GroupConfig, state: StateStore, mode: Mode) -> list[RequestSpec]:
        return [self.spec_for(group, r) for r in list_inbox_files(self._root, group.source_id)]

    def fetch(self, spec: RequestSpec, http: HttpClient | None, state: StateStore) -> FetchResult:
        path = resolve_inbox_file(self._root, spec.source_id, _rel_of(spec.url))
        body = path.read_bytes()
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        # fetched_at = the actual import time, never the file's date (I-ING-3, T14 carry-over)
        return FetchResult(spec, "new", 200, body, self._clock(), None, None, ctype, None)

    def parse(self, raw: RawObject, series_filter: SeriesFilter) -> ParseOutput:
        if raw.parser_id is None:
            raise ManualInboxError("a manual group needs a parser")
        return registry.resolve(raw.parser_id)(raw, series_filter)


@dataclass
class ManualReport:
    outcomes: dict[str, str] = field(default_factory=dict)  # rel path -> outcome or error
    raw_ids: list[int] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return all(not v.startswith("error") for v in self.outcomes.values())


def ingest_files(
    conn: psycopg.Connection,
    store: archive.RawStore,
    connector: ManualConnector,
    group: GroupConfig,
    *,
    run_id: int,
    parser_id: str,
    archive_mode: Literal["public", "hash_only"],
    root: Path,
    only: str | None = None,
    sidecar_required: tuple[str, ...] = SIDECAR_REQUIRED_DEFAULT,
    edition_ordered: bool = False,
) -> ManualReport:
    """Archive, record and stage every inbox file of the group (or just ``only``).

    A bad sidecar or parse failure is recorded per file and does not stop the others.
    """
    report = ManualReport()
    flt = SeriesFilter(
        series_refs=frozenset(e.key for e in group.series),
        missing_markers=group.missing_markers,
    )
    files = [only] if only is not None else list_inbox_files(root, group.source_id)
    for rel in files:
        try:
            path = resolve_inbox_file(root, group.source_id, rel)
            side = read_sidecar(path, required=sidecar_required, edition_ordered=edition_ordered)
            spec = connector.spec_for(group, rel)
            result = connector.fetch(spec, None, _NoState())
            ctx = archive.ObjectContext(
                run_id=run_id,
                parser_id=parser_id,
                archive_mode=archive_mode,
                basename=path.name,
                manual=True,
                edition_label=side.edition_label,
                edition_date=side.edition_date,
                import_label=side.import_label,
            )

            def stage(c: psycopg.Connection, raw_id: int, _r: FetchResult = result) -> None:
                assert _r.body is not None
                out = connector.parse(
                    RawObject(_r.body, group.source_id, group.group_id, _r.fetched_at, parser_id),
                    flt,
                )
                stage_output(c, run_id=run_id, raw_id=raw_id, output=out)

            outcome = archive.record_fetch(conn, store, result, ctx, stage=stage)
            archive.collect_manifest_line(store, outcome)
            report.outcomes[rel] = outcome.outcome
            if outcome.outcome == "new" and outcome.raw_id is not None:
                report.raw_ids.append(outcome.raw_id)
        except Exception as exc:  # per-file isolation
            conn.rollback()
            log.error("manual import of %s failed: %s", rel, exc)
            report.outcomes[rel] = f"error: {type(exc).__name__}: {exc}"[:300]
    return report


class _NoState:
    def latest(self, source_id: str, request_key: str) -> Any:  # pragma: no cover - unused
        raise NotImplementedError
