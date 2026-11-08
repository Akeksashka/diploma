"""``rebuild`` and the production re-staging hook (T51; ADR-002, ADR-003, ADR-008).

Re-parse archived bytes with the RECORDED ``parser_id`` and the series map at the RECORDED
``git_sha`` (the fetch run's), then replay the loads with their recorded outcomes. Config at a
sha is read with ``git show``; when a sha is not in the local history (shallow checkout) the
working tree is used instead and the result is labelled ``approximate`` (never silent). In
``exact`` mode a missing sha is a missing prerequisite and nothing is replayed.

Known limits: a series released from deferral is replayed with its object (not at release time)
and series versions created by a release are not re-created (first-sight creates version 1);
snapshots (``ingest.raw_snapshot``) are not rebuilt.
"""

from __future__ import annotations

import subprocess
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import psycopg

from macro_monitor.ingestion import registry
from macro_monitor.ingestion.archive import RawStore, RawStoreError, StorageRef
from macro_monitor.ingestion.base import RawObject, SeriesFilter
from macro_monitor.ingestion.fetch import stage_output
from macro_monitor.registry.config import load_yaml_text
from macro_monitor.registry.sync import MapEntry
from macro_monitor.storage import loader, manifest, replay
from macro_monitor.storage.loader import LoaderError, QueuedObject, RestageFn
from macro_monitor.storage.series_create import MapProvider

Mode = Literal["exact", "approximate"]


class RestageError(LoaderError):
    """Archived bytes cannot be re-parsed (bytes missing/corrupt, parser unknown)."""


class RebuildPrerequisiteError(LoaderError):
    """A rebuild prerequisite is missing; nothing was replayed."""


def sha_available(root: Path, sha: str) -> bool:
    """True when ``config/sources.yaml`` can be read at ``sha`` from git history."""
    if not sha or sha == "unknown":
        return False
    proc = subprocess.run(
        ["git", "-C", str(root), "cat-file", "-e", f"{sha}:config/sources.yaml"],
        capture_output=True, check=False,
    )  # fmt: skip
    return proc.returncode == 0


class ConfigAtSha:
    """Config reader at a git sha; records the shas that had to fall back to the working tree."""

    def __init__(self, root: Path, maps: MapProvider) -> None:
        self.root = root
        self._maps = maps
        self.approximate: set[str] = set()

    def _note(self, sha: str) -> None:
        if not sha_available(self.root, sha):
            self.approximate.add(sha)

    def maps(self, source_id: str, group_id: str, git_sha: str) -> list[MapEntry]:
        self._note(git_sha)
        return list(self._maps(source_id, group_id, git_sha))

    def missing_markers(self, source_id: str, group_id: str, git_sha: str) -> frozenset[str]:
        self._note(git_sha)
        text: str | None = None
        if sha_available(self.root, git_sha):
            proc = subprocess.run(
                ["git", "-C", str(self.root), "show", f"{git_sha}:config/sources.yaml"],
                capture_output=True, text=True, check=False,
            )  # fmt: skip
            text = proc.stdout if proc.returncode == 0 else None
        if text is None:
            text = (self.root / "config" / "sources.yaml").read_text(encoding="utf-8")
        for s in load_yaml_text(text)["sources"]:
            if s["id"] == source_id:
                for g in s["groups"]:
                    if g["id"] == group_id:
                        return frozenset(g.get("missing_markers") or ())
        return frozenset()


def _dataset_of(url: str, entries: list[MapEntry]) -> str | None:
    """The mapped dataset named in the request path (as ``fetch.default_filter`` does)."""
    path = urlparse(url).path.rstrip("/")
    return next(
        (d for d in sorted({e.dataset for e in entries}) if path.endswith("/" + d)),
        None,
    )


def make_restage(store: RawStore, config: ConfigAtSha) -> RestageFn:
    """Production ``RestageFn``: stored bytes -> recorded parser -> ``staging.*`` rows."""

    def restage(conn: psycopg.Connection, obj: QueuedObject, run_id: int) -> None:
        blob = manifest.get_blob(conn, obj.sha256)
        row = conn.execute(
            "SELECT o.request_url, r.git_sha FROM ingest.raw_object o "
            "JOIN ingest.run r ON r.run_id = o.run_id WHERE o.raw_id = %s",
            [obj.raw_id],
        ).fetchone()
        if blob is None or blob.storage_ref is None or blob.storage_backend == "none" or not row:
            raise RestageError(f"raw_id {obj.raw_id}: no archived bytes")
        try:
            data = store.get(StorageRef.decode(blob.storage_backend, blob.storage_ref))
            parse = registry.resolve(obj.parser_id)
        except (RawStoreError, ValueError, LookupError) as exc:
            raise RestageError(f"raw_id {obj.raw_id}: {type(exc).__name__}: {exc}") from exc
        url, git_sha = str(row[0]), str(row[1])
        entries = config.maps(obj.source_id, obj.group_id, git_sha)
        dataset = _dataset_of(url, entries)
        flt = SeriesFilter(
            series_refs=frozenset(
                e.key for e in entries if dataset is None or e.dataset == dataset
            ),
            missing_markers=config.missing_markers(obj.source_id, obj.group_id, git_sha),
        )  # fmt: skip
        output = parse(
            RawObject(data, obj.source_id, obj.group_id, obj.fetched_at, obj.parser_id), flt
        )
        stage_output(conn, run_id=run_id, raw_id=obj.raw_id, output=output, dataset=dataset)

    return restage


@dataclass
class Prerequisites:
    unknown_parsers: list[str] = field(default_factory=list)  # T-DDL-14
    missing_bytes: list[int] = field(default_factory=list)  # raw_ids of loaded objects
    missing_shas: list[str] = field(default_factory=list)  # git shas not in local history

    def blocking(self, mode: Mode) -> bool:
        return bool(
            self.unknown_parsers or self.missing_bytes or (mode == "exact" and self.missing_shas)
        )


def check_prerequisites(conn: psycopg.Connection, store: RawStore, root: Path) -> Prerequisites:
    out = Prerequisites()
    parsers = conn.execute("SELECT DISTINCT parser_id FROM ingest.raw_object ORDER BY 1").fetchall()
    out.unknown_parsers = [str(p[0]) for p in parsers if str(p[0]) not in registry.RELEASED_PARSERS]
    blobs = conn.execute(
        "SELECT o.raw_id, b.storage_backend, b.storage_ref FROM ingest.raw_object o "
        "JOIN ingest.raw_blob b USING (sha256) JOIN ingest.raw_load l USING (raw_id) "
        "WHERE l.outcome = 'loaded' ORDER BY 1"
    ).fetchall()
    for raw_id, backend, ref in blobs:
        try:
            if backend == "none" or ref is None:
                raise RestageError("no bytes")
            store.get(StorageRef.decode(backend, ref))
        except (RawStoreError, ValueError, LoaderError):
            out.missing_bytes.append(int(raw_id))
    shas = conn.execute(
        "SELECT DISTINCT git_sha FROM ingest.run WHERE run_id IN "
        "(SELECT run_id FROM ingest.raw_object UNION SELECT load_run_id FROM ingest.raw_load) "
        "ORDER BY 1"
    ).fetchall()
    conn.rollback()
    out.missing_shas = [str(s[0]) for s in shas if not sha_available(root, str(s[0]))]
    return out


@dataclass
class RebuildReport:
    mode: Mode
    objects: int = 0
    approximate_shas: list[str] = field(default_factory=list)
    prerequisites: Prerequisites = field(default_factory=Prerequisites)

    @property
    def label(self) -> str:
        return "approximate" if self.approximate_shas else "exact"


def rebuild(
    conn: psycopg.Connection,
    store: RawStore,
    root: Path,
    maps: MapProvider,
    *,
    mode: Mode = "exact",
    insert_factory: Callable[[MapProvider], loader.InsertFn] = loader.make_insert,
) -> RebuildReport:
    """Replay raw into an empty ``curated.observation`` (refuses otherwise).

    Needs the manifest, ``raw_load`` outcomes, decisions and ``ref.*`` (after ``sync-config``)
    in the database and the archived bytes in ``store``. Returns the report; raises
    ``RebuildPrerequisiteError`` (nothing replayed) when a prerequisite is missing.
    """
    report = RebuildReport(mode=mode)
    report.prerequisites = check_prerequisites(conn, store, root)
    if report.prerequisites.blocking(mode):
        p = report.prerequisites
        raise RebuildPrerequisiteError(
            f"unknown parsers {p.unknown_parsers}; missing bytes for raw_ids {p.missing_bytes}; "
            f"config shas not in git history {p.missing_shas} (mode={mode})"
        )
    if conn.execute("SELECT 1 FROM curated.observation LIMIT 1").fetchone() is not None:
        conn.rollback()
        raise RebuildPrerequisiteError("curated.observation is not empty")
    conn.rollback()
    config = ConfigAtSha(root, maps)
    report.objects = replay.replay_objects(
        conn, insert_factory(config.maps), make_restage(store, config)
    )
    report.approximate_shas = sorted(config.approximate)
    return report
