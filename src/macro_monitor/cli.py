"""Command-line entry point (console script ``macro-monitor``).

Commands (ingestion spec section 7): ``sync-config``, ``migrate``, ``plan``, ``fetch``, ``load``,
``analyze``, ``config-report`` (offline stub). Exit codes: 0 ok; 10 partial; 20 config; 30 database
error; 40 migration mismatch. Every argument is validated against an allow-list; workflow inputs
arrive through environment variables (``MM_MODE``, ``MM_GROUPS``, ``MM_RAW_ID``) and are
validated the same way. The database URL is read from ``DATABASE_URL`` and is never printed.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime
from importlib import import_module
from pathlib import Path
from typing import Any, NoReturn

import psycopg
import yaml

from macro_monitor import __version__
from macro_monitor.ingestion import archive
from macro_monitor.ingestion.base import Connector, GroupConfig, Mode, SeriesMapEntry
from macro_monitor.ingestion.connectors import ecb as ecb_connector
from macro_monitor.ingestion.connectors.bulk import BULK_SOURCES, BulkConnector, DbnomicsConnector
from macro_monitor.ingestion.connectors.manual import (
    SIDECAR_REQUIRED_DEFAULT,
    ManualConnector,
    ManualInboxError,
    ingest_files,
)
from macro_monitor.ingestion.connectors.rest import WorldBankConnector
from macro_monitor.ingestion.connectors.sdmx import (
    EurostatConnector,
    OecdConnector,
    load_series_entries,
)
from macro_monitor.ingestion.fetch import (
    FetchRunReport,
    GroupJob,
    close_run,
    fetch_groups,
    open_run,
)
from macro_monitor.ingestion.http import HttpClient, HttpSettings
from macro_monitor.ingestion.registry import RELEASED_PARSERS
from macro_monitor.ingestion.robots import RobotsGate
from macro_monitor.ingestion.state import PostgresBudgetStore, PostgresRobotsCache
from macro_monitor.registry.config import ConfigError, check_env_present
from macro_monitor.registry.report import build_report
from macro_monitor.registry.sync import LoadedConfig, load_config, sync_config
from macro_monitor.settings import (
    ENV_DATABASE_URL,
    ENV_MM_GROUPS,
    ENV_MM_MODE,
    ENV_MM_RAW_ID,
    MODES,
    InputError,
    Settings,
    parse_group_id,
    parse_groups,
    parse_inbox_path,
    parse_iso_date,
    parse_mode,
    parse_raw_id,
)
from macro_monitor.storage import decide as decisions
from macro_monitor.storage import loader, rebuild
from macro_monitor.storage.db import DatabaseError, connect
from macro_monitor.storage.migrate import check_schema_version, migrate
from macro_monitor.storage.series_create import git_map_provider
from macro_monitor.validation.revision_checks import make_ordinary_checks

EXIT_OK = 0
EXIT_PARTIAL = 10
EXIT_CONFIG_ERROR = 20
EXIT_DATABASE_ERROR = 30
EXIT_MIGRATION_MISMATCH = 40

DEFAULT_JOB_TIMEOUT_MIN = 120

log = logging.getLogger("macro_monitor.cli")


class CliError(Exception):
    """A failure with an exit code; the message is safe to print (no secrets)."""

    def __init__(self, message: str, exit_code: int = EXIT_CONFIG_ERROR) -> None:
        super().__init__(message)
        self.exit_code = exit_code


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> NoReturn:
        self.print_usage(sys.stderr)
        sys.stderr.write(f"{self.prog}: error: {message}\n")
        raise SystemExit(EXIT_CONFIG_ERROR)


# ------------------------------------------------------------------------------ argument types


def _allow(parse: Any) -> Any:
    def convert(text: str) -> Any:
        try:
            return parse(text)
        except InputError as exc:
            raise argparse.ArgumentTypeError(str(exc)) from exc

    return convert


def _root(text: str) -> Path:
    path = Path(text)
    if "\0" in text or not path.is_dir():
        raise argparse.ArgumentTypeError("root must be an existing directory")
    return path


def build_parser() -> argparse.ArgumentParser:
    parser = _Parser(prog="macro-monitor", description="Macro Monitor command-line interface.")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command", parser_class=_Parser)

    def common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--root", type=_root, default=None, help="repository root (default: cwd)")

    p = sub.add_parser("sync-config", help="validate config and load it into ref.*")
    common(p)
    p = sub.add_parser("migrate", help="apply pending migrations (owner role)")
    common(p)
    p = sub.add_parser("plan", help="choose fetch and load groups; print matrix JSON")
    common(p)
    p.add_argument("--mode", type=_allow(parse_mode), choices=MODES, default=None)
    p = sub.add_parser("fetch", help="fetch one group")
    common(p)
    p.add_argument("--group", type=_allow(parse_group_id), required=True)
    p.add_argument("--mode", type=_allow(parse_mode), choices=MODES, default=None)
    p = sub.add_parser("load", help="validate and load the queue of unloaded objects")
    common(p)
    p.add_argument("--drain", action="store_true", help="drain the whole queue")
    p.add_argument("--groups", type=_allow(parse_groups), default=None)
    p.add_argument("--raw-id", type=_allow(parse_raw_id), default=None)
    p = sub.add_parser("decide", help="record a human decision, then drain (workflows spec 11)")
    common(p)
    p.add_argument("--kind", choices=("drift", "override"), required=True)
    p.add_argument("--decision", type=_allow(parse_decision), required=True)
    p.add_argument("--event-id", type=_allow(parse_raw_id), default=None)
    p.add_argument("--raw-id", type=_allow(parse_raw_id), default=None)
    p.add_argument("--series-id", type=_allow(parse_raw_id), default=None)
    p.add_argument("--ref-period-start", type=_allow(parse_iso_date), default=None)
    p.add_argument("--known-at", type=_allow(parse_timestamp), default=None)
    p.add_argument("--note", type=_allow(parse_note), default=None)
    p.add_argument("--decided-by", type=_allow(parse_actor), default=None)
    p.add_argument("--decided-on", type=_allow(parse_iso_date), default=None)
    p = sub.add_parser("rebuild", help="replay archived raw into an empty curated layer")
    common(p)
    p.add_argument("--mode", choices=("exact", "approximate"), default="exact")
    p = sub.add_parser("ingest-manual", help="import manual_inbox files, then drain their group")
    common(p)
    p.add_argument("--group", type=_allow(parse_group_id), required=True)
    p.add_argument("--path", type=_allow(parse_inbox_path), default=None)
    p = sub.add_parser("analyze", help="run the analytics (snapshot, ranks, scorecards, alerts)")
    common(p)
    p.add_argument("--ingest-run-id", type=_allow(parse_raw_id), default=None)
    p.add_argument(
        "--as-of", type=_allow(parse_iso_date), default=None, help="run date, YYYY-MM-DD"
    )
    p = sub.add_parser("export", help="write the dashboard data tree (mm_reader, read-only)")
    common(p)
    p.add_argument("--ingest-run-id", type=_allow(parse_raw_id), required=True)
    p.add_argument(
        "--out", default="export", help="output directory (data/ and export-status.json)"
    )
    p = sub.add_parser("record-export", help="insert export-status.json into ops.export_status")
    common(p)
    p.add_argument("--status-file", required=True, help="export-status.json of the export step")
    p = sub.add_parser("check-site", help="fail when the built site exceeds the 300 MB budget")
    common(p)
    p.add_argument("--site-dir", required=True, help="built site directory")
    p = sub.add_parser("config-report", help="offline config coverage report (stub)")
    common(p)
    p = sub.add_parser("backup", help="write the public database dump (ADR-015)")
    common(p)
    p.add_argument("--profile", required=True, choices=("public",), help="dump profile")
    p.add_argument("--out", default="data/dump", help="empty output directory")
    p = sub.add_parser("restore-test", help="restore a public dump with psql and re-dump (T71)")
    common(p)
    p.add_argument("--dir", required=True, help="directory with the downloaded release assets")
    p.add_argument("--no-roundtrip", action="store_true", help="skip the re-dump comparison")
    return parser


# ----------------------------------------------------------------------------------- helpers


def _dsn(settings: Settings) -> str:
    if not settings.database_url:
        raise CliError(f"{ENV_DATABASE_URL} is not set")
    return settings.database_url


def _env_value(name: str, environ: Mapping[str, str]) -> str | None:
    value = environ.get(name)
    return value if value else None


def _config(root: Path) -> LoadedConfig:
    try:
        return load_config(root)
    except ConfigError as exc:
        raise CliError(f"config error:\n{exc}") from exc
    except (OSError, yaml.YAMLError) as exc:
        raise CliError(f"config error: {type(exc).__name__}: {exc}") from exc


def _groups_of(
    cfg: LoadedConfig, *, enabled_only: bool
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    out: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for s in cfg.sources.data["sources"]:
        for g in s.get("groups") or []:
            if enabled_only and not cfg.sources.effective_group_enabled.get(
                (s["id"], g["id"]), True
            ):
                continue
            out.append((s, g))
    return out


def _mode(arg: str | None, environ: Mapping[str, str]) -> str:
    return parse_mode(arg or _env_value(ENV_MM_MODE, environ) or "refresh")


def _release_tag(store: archive.RawStore, run_id: int, today: date) -> str | None:
    if store.backend_id != "release_public":
        return None
    return f"raw-{today.isoformat()}-r{run_id}"  # the draft is opened by T45


# ------------------------------------------------------------------------------------ commands


def cmd_sync_config(args: argparse.Namespace, settings: Settings, root: Path) -> int:
    cfg = _config(root)
    with connect(_dsn(settings)) as conn:
        check_schema_version(conn)
        conn.rollback()
        rep = sync_config(
            conn, root, git_sha=settings.git_sha, code_version=__version__,
            trigger=settings.trigger, config=cfg,
        )  # fmt: skip
    print(
        f"sync-config ok: run_id={rep.run_id} mapped={len(rep.mapped)} pending={len(rep.pending)}"
    )
    return EXIT_OK


def cmd_migrate(args: argparse.Namespace, settings: Settings, root: Path) -> int:
    dsn = _dsn(settings)
    with connect(dsn) as conn:
        versions = migrate(conn, dsn=dsn)
    print(f"migrate ok: applied {versions}" if versions else "migrate ok: up to date")
    return EXIT_OK


def cmd_plan(args: argparse.Namespace, settings: Settings, root: Path) -> int:
    mode = _mode(args.mode, os.environ)
    cfg = _config(root)
    issues = check_env_present(cfg.sources, os.environ)
    if issues:
        raise CliError("config error:\n" + "\n".join(str(i) for i in issues))
    for w in cfg.sources.warnings:
        print(f"warning: {w}", file=sys.stderr)
    try:
        store = archive.raw_store_from_env(os.environ)  # refuses local_dir in production
    except archive.RawStoreConfigError as exc:
        raise CliError(f"config error: {exc}") from exc

    fetch_pairs: list[tuple[str, int]] = []
    if mode in ("refresh", "catchup"):  # manual and preflight fetch nothing in this command
        for _source, group in _groups_of(cfg, enabled_only=True):
            fetch_pairs.append(
                (group["id"], int(group.get("job_timeout_min") or DEFAULT_JOB_TIMEOUT_MIN))
            )

    now = datetime.now(UTC)
    with connect(_dsn(settings)) as conn:
        check_schema_version(conn)
        backlog = [
            r[1]
            for r in conn.execute(
                "SELECT DISTINCT source_id, group_id FROM ingest.v_raw_unloaded "
                "ORDER BY source_id, group_id"
            ).fetchall()
        ]
        conn.rollback()
        run_id = open_run(
            conn, workflow="plan", trigger=settings.trigger, mode=mode,
            git_sha=settings.git_sha, code_version=__version__, started_at=now,
            gh_run_id=settings.gh_run_id, gh_run_attempt=settings.gh_run_attempt,
        )  # fmt: skip
        # TODO(T45): open the draft raw release raw-<date>-r<run_id>; stubbed here.
        close_run(conn, run_id, "ok")
    load_groups = list(dict.fromkeys([g for g, _ in fetch_pairs] + backlog))
    out = {
        "run_id": run_id,
        "mode": mode,
        "release_tag": _release_tag(store, run_id, now.date()),
        "fetch_matrix": {"include": [{"group": g, "job_timeout_min": t} for g, t in fetch_pairs]},
        "load_groups": ",".join(load_groups),
    }
    print(json.dumps(out, sort_keys=True))
    return EXIT_OK


def _parser_id(spec: str) -> str:
    module_name = spec.partition(":")[0]
    version = getattr(import_module(module_name), "PARSER_VERSION", None)
    parser_id = f"{module_name.rsplit('.', 1)[-1]}@{version}"
    if parser_id not in RELEASED_PARSERS:
        raise CliError(f"parser {spec!r} resolves to {parser_id!r}, which is not released")
    return parser_id


def _ladder(source: Mapping[str, Any]) -> tuple[str, ...] | None:
    """The source's ``change_detection`` ladder (None = connector default)."""
    value = source.get("change_detection")
    return None if not value else tuple(str(v) for v in value)


def _connector(source: Mapping[str, Any]) -> Connector:
    sid = source["id"]
    if sid == "eurostat":
        return EurostatConnector(_ladder(source))
    if sid == "worldbank":
        return WorldBankConnector()
    if sid in BULK_SOURCES:
        return BulkConnector(sid)
    if sid == "dbnomics":
        return DbnomicsConnector()
    if sid == "ecb":
        return ecb_connector.EcbConnector()
    if sid == "oecd":
        return OecdConnector(_ladder(source))
    raise CliError(f"no connector for source {source['id']!r}")


def _series_for(source: Mapping[str, Any], path: Path) -> tuple[SeriesMapEntry, ...]:
    """Series-map whitelist; the ECB map also carries the euro-area composition."""
    if source["id"] == "ecb":
        return ecb_connector.load_series_entries(path)
    return load_series_entries(path)


def cmd_fetch(args: argparse.Namespace, settings: Settings, root: Path) -> int:
    mode = _mode(args.mode, os.environ)
    cfg = _config(root)
    found = [(s, g) for s, g in _groups_of(cfg, enabled_only=False) if g["id"] == args.group]
    if not found:
        raise CliError(f"unknown group {args.group!r}")
    source, group = found[0]
    off = cfg.sources.group_off_reason(source["id"], group["id"])
    if off:
        raise CliError(f"config error: group {args.group!r} is disabled: {off}")
    try:
        store = archive.raw_store_from_env(os.environ)
    except archive.RawStoreConfigError as exc:
        raise CliError(f"config error: {exc}") from exc
    series = _series_for(source, root / group["series_map"])
    job = GroupJob(
        source=source,
        group=GroupConfig.from_config(source, group, series),
        connector=_connector(source),
        parser_id=_parser_id(group["parser"]),
        archive_mode="hash_only" if source.get("archive") == "hash_only" else "public",
    )
    auth = source.get("auth") or {}
    secret = os.environ.get(auth["env"]) if auth.get("type") not in (None, "none") else None
    dsn = _dsn(settings)
    with connect(dsn) as conn, connect(dsn) as aux:  # aux: budgets and robots cache
        check_schema_version(conn)
        conn.rollback()
        run_id = open_run(
            conn, workflow="fetch", trigger=settings.trigger, mode=mode,
            git_sha=settings.git_sha, code_version=__version__, started_at=datetime.now(UTC),
            gh_run_id=settings.gh_run_id, gh_run_attempt=settings.gh_run_attempt,
        )  # fmt: skip

        def http_for(j: GroupJob) -> HttpClient:
            return HttpClient(
                HttpSettings.from_source(j.source),
                repo_url=settings.repo_url,
                budgets=PostgresBudgetStore(aux, str(j.source["id"])),
                secrets=[secret] if secret else [],
                secret_params=[auth["name"]] if secret and auth.get("name") else [],
            )

        def robots_for(j: GroupJob, http: HttpClient) -> RobotsGate:
            return RobotsGate(http, PostgresRobotsCache(aux, str(j.source["id"])))

        report = fetch_groups(
            conn, store, [job], http_for, run_id=run_id, mode=_as_mode(mode), robots_for=robots_for
        )
    _print_fetch_summary(report)
    return EXIT_OK if report.status == "ok" else EXIT_PARTIAL


def _print_fetch_summary(report: FetchRunReport) -> None:
    for g in report.groups:
        print(f"fetch {g.group_id}: outcomes={g.outcomes} error={g.error}")
        if g.deferred:
            print(f"  deferred to catch-up ({len(g.deferred)}): {', '.join(g.deferred)}")
        if g.skipped:
            print(f"  skipped after a block ({len(g.skipped)}): {', '.join(g.skipped)}")


def _as_mode(mode: str) -> Mode:
    assert mode in MODES
    return mode  # type: ignore[return-value]


def cmd_load(args: argparse.Namespace, settings: Settings, root: Path) -> int:
    environ = os.environ
    try:
        raw_id = args.raw_id
        if raw_id is None and _env_value(ENV_MM_RAW_ID, environ):
            raw_id = parse_raw_id(str(environ[ENV_MM_RAW_ID]))
        groups = args.groups
        if groups is None:
            groups = parse_groups(environ.get(ENV_MM_GROUPS, ""))
    except InputError as exc:
        raise CliError(f"config error: {exc}") from exc
    try:
        archive.raw_store_from_env(environ)  # refuses local_dir in production (spec 4a)
    except archive.RawStoreConfigError as exc:
        raise CliError(f"config error: {exc}") from exc
    cfg = _config(root)
    by_group: dict[str, str] = {g["id"]: s["id"] for s, g in _groups_of(cfg, enabled_only=False)}
    unknown = [g for g in groups if g not in by_group]
    if unknown:
        raise CliError(f"unknown group(s): {', '.join(unknown)}")
    only = None if args.drain or not groups else [(by_group[g], g) for g in groups]

    with connect(_dsn(settings)) as conn:
        check_schema_version(conn)
        conn.rollback()
        run_id = open_run(
            conn, workflow="load", trigger=settings.trigger, mode="refresh",
            git_sha=settings.git_sha, code_version=__version__, started_at=datetime.now(UTC),
            gh_run_id=settings.gh_run_id, gh_run_attempt=settings.gh_run_attempt,
        )  # fmt: skip
        maps = git_map_provider(root)
        chk = make_ordinary_checks(run_id, loader.make_insert(maps))  # one instance per drain
        hooks: dict[str, Any] = {
            "insert": chk.insert, "validate": chk.validate, "post_checks": chk.post_checks,
            "restage": rebuild.make_restage(
                archive.raw_store_from_env(environ), rebuild.ConfigAtSha(root, maps)
            ),
        }  # fmt: skip
        ok = True
        try:
            if raw_id is not None:
                res = loader.load_raw_id(conn, raw_id, run_id=run_id, **hooks)
                print(f"load raw_id={res.raw_id}: {res.status}")
                ok = res.status in loader.TERMINAL
            else:
                rep = loader.drain(conn, run_id=run_id, only=only, maps=maps, **hooks)
                for r in rep.results:
                    print(f"load raw_id={r.raw_id}: {r.status}")
                ok = rep.ok
        except loader.LoaderError as exc:
            conn.rollback()
            print(f"load refused: {exc}", file=sys.stderr)
            ok = False
        close_run(conn, run_id, "ok" if ok else "partial")
    return EXIT_OK if ok else EXIT_PARTIAL


_DECISIONS = ("accepted", "rejected", "reopened", "skip_object", "exclude", "include")
_ACTOR = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})")
_TIMESTAMP = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z")
_NOTE = re.compile(r"[A-Za-z0-9 .,;:()/_'+=%-]{1,500}")


def parse_decision(text: str) -> str:
    if text not in _DECISIONS:
        raise InputError(f"decision must be one of {', '.join(_DECISIONS)}")
    return text


def parse_actor(text: str) -> str:
    if _ACTOR.fullmatch(text) is None:
        raise InputError("decided-by must be a GitHub login")
    return text


def parse_timestamp(text: str) -> datetime:
    if _TIMESTAMP.fullmatch(text) is None:
        raise InputError("known-at must be YYYY-MM-DDTHH:MM:SS[.ffffff]Z (UTC)")
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def parse_note(text: str) -> str:
    if _NOTE.fullmatch(text) is None:
        raise InputError("note: 1-500 characters of letters, digits and basic punctuation")
    return text


def cmd_decide(args: argparse.Namespace, settings: Settings, root: Path) -> int:
    decision: str = args.decision
    actor = args.decided_by or os.environ.get("GITHUB_ACTOR", "")
    try:
        actor = parse_actor(actor)
    except InputError as exc:
        raise CliError(f"config error: {exc}") from exc
    on = args.decided_on or date.today()
    drift_ok = args.kind == "drift" and decision in ("accepted", "rejected", "reopened")
    skip_ok = args.kind == "drift" and decision == "skip_object"
    override_ok = args.kind == "override" and decision in ("exclude", "include")
    if not (drift_ok or skip_ok or override_ok):
        raise CliError(f"decision {decision!r} does not apply to kind {args.kind!r}")
    if drift_ok and args.event_id is None:
        raise CliError("--event-id is required")
    if skip_ok and args.raw_id is None:
        raise CliError("--raw-id is required")
    if override_ok and (args.series_id is None or args.ref_period_start is None):
        raise CliError("--series-id and --ref-period-start are required")
    if override_ok and not args.note:
        raise CliError("--note (the reason) is required for an override")
    maps = git_map_provider(root)
    with connect(_dsn(settings)) as conn:
        check_schema_version(conn)
        conn.rollback()
        run_id = open_run(
            conn, workflow="decide", trigger=settings.trigger, mode="refresh",
            git_sha=settings.git_sha, code_version=__version__, started_at=datetime.now(UTC),
            gh_run_id=settings.gh_run_id, gh_run_attempt=settings.gh_run_attempt,
        )  # fmt: skip
        conn.commit()
        try:
            if drift_ok:
                did = decisions.decide_drift(
                    conn, event_id=args.event_id, decision=decision, decided_by=actor,  # type: ignore[arg-type]
                    decided_on=on, note=args.note, git_sha=settings.git_sha,
                )  # fmt: skip
                print(f"decide drift event_id={args.event_id}: {decision} (decision_id={did})")
            elif skip_ok:
                decisions.skip_object(
                    conn, raw_id=args.raw_id, run_id=run_id, decided_by=actor, decided_on=on,
                    note=args.note,
                )  # fmt: skip
                print(f"decide skip_object raw_id={args.raw_id}")
            else:
                oid = decisions.quality_override(
                    conn, series_id=args.series_id, ref_period_start=args.ref_period_start,
                    known_at=args.known_at, decision=decision, reason=args.note,
                    decided_by=actor, decided_on=on,
                )  # fmt: skip
                print(f"decide override {decision} (override_id={oid})")
        except decisions.DecideError as exc:
            conn.rollback()
            close_run(conn, run_id, "failed")
            raise CliError(f"decide refused: {exc}") from exc
        ok = True
        if not override_ok:  # accepted decisions load the deferred series from stored raw
            chk = make_ordinary_checks(run_id, loader.make_insert(maps))
            try:
                restage = rebuild.make_restage(
                    archive.raw_store_from_env(os.environ), rebuild.ConfigAtSha(root, maps)
                )
            except archive.RawStoreConfigError as exc:
                close_run(conn, run_id, "failed")
                raise CliError(f"config error: {exc}") from exc
            rep = loader.drain(
                conn, run_id=run_id, maps=maps, insert=chk.insert, validate=chk.validate,
                post_checks=chk.post_checks, restage=restage,
            )  # fmt: skip
            for r in rep.results:
                print(f"load raw_id={r.raw_id}: {r.status}")
            for raw_id, ref in rep.release.loaded:
                print(f"released raw_id={raw_id} {ref}")
            for raw_id, ref, why in rep.release.pending:
                print(f"still deferred raw_id={raw_id} {ref}: {why}")
            ok = rep.ok
        close_run(conn, run_id, "ok" if ok else "partial")
    return EXIT_OK if ok else EXIT_PARTIAL


def cmd_rebuild(args: argparse.Namespace, settings: Settings, root: Path) -> int:
    try:
        store = archive.raw_store_from_env(os.environ)
    except archive.RawStoreConfigError as exc:
        raise CliError(f"config error: {exc}") from exc
    with connect(_dsn(settings)) as conn:
        check_schema_version(conn)
        conn.rollback()
        try:
            rep = rebuild.rebuild(conn, store, root, git_map_provider(root), mode=args.mode)
        except rebuild.RebuildPrerequisiteError as exc:
            conn.rollback()
            print(f"rebuild refused: {exc}", file=sys.stderr)
            return EXIT_PARTIAL
    print(f"rebuild {rep.label}: objects={rep.objects} requested_mode={rep.mode}")
    if rep.approximate_shas:
        print(f"approximate: config read from the working tree for shas {rep.approximate_shas}")
    return EXIT_OK


def cmd_ingest_manual(args: argparse.Namespace, settings: Settings, root: Path) -> int:
    cfg = _config(root)
    found = [(s, g) for s, g in _groups_of(cfg, enabled_only=False) if g["id"] == args.group]
    if not found:
        raise CliError(f"unknown group {args.group!r}")
    source, group = found[0]
    off = cfg.sources.group_off_reason(source["id"], group["id"])
    if off:
        raise CliError(f"config error: group {args.group!r} is disabled: {off}")
    if source.get("kind") != "manual":
        raise CliError(f"group {args.group!r} does not belong to a manual source")
    try:
        store = archive.raw_store_from_env(os.environ)
    except archive.RawStoreConfigError as exc:
        raise CliError(f"config error: {exc}") from exc
    inbox = source.get("inbox") or {}
    series = load_series_entries(root / group["series_map"])
    gcfg = GroupConfig.from_config(source, group, series)
    connector = ManualConnector(root)
    with connect(_dsn(settings)) as conn:
        check_schema_version(conn)
        conn.rollback()
        run_id = open_run(
            conn, workflow="ingest-manual", trigger=settings.trigger, mode="manual",
            git_sha=settings.git_sha, code_version=__version__, started_at=datetime.now(UTC),
            gh_run_id=settings.gh_run_id, gh_run_attempt=settings.gh_run_attempt,
        )  # fmt: skip
        try:
            rep = ingest_files(
                conn, store, connector, gcfg, run_id=run_id, root=root, only=args.path,
                parser_id=_parser_id(group["parser"]),
                archive_mode="hash_only" if source.get("archive") == "hash_only" else "public",
                sidecar_required=tuple(inbox.get("sidecar_required") or SIDECAR_REQUIRED_DEFAULT),
                edition_ordered=bool(group.get("edition_ordered", False)),
            )  # fmt: skip
        except ManualInboxError as exc:
            close_run(conn, run_id, "failed")
            raise CliError(f"config error: {exc}") from exc
        for rel, outcome in rep.outcomes.items():
            print(f"ingest-manual {rel}: {outcome}")
        ok = rep.ok
        maps = git_map_provider(root)
        chk = make_ordinary_checks(run_id, loader.make_insert(maps))
        try:
            drained = loader.drain(
                conn, run_id=run_id, only=[(source["id"], group["id"])],
                insert=chk.insert, validate=chk.validate, post_checks=chk.post_checks,
            )  # fmt: skip
            for r in drained.results:
                print(f"load raw_id={r.raw_id}: {r.status}")
            ok = ok and drained.ok
        except loader.LoaderError as exc:
            conn.rollback()
            print(f"load refused: {exc}", file=sys.stderr)
            ok = False
        close_run(conn, run_id, "ok" if ok else "partial")
    return EXIT_OK if ok else EXIT_PARTIAL


def cmd_analyze(args: argparse.Namespace, settings: Settings, root: Path) -> int:
    from macro_monitor.analytics import run as analytics_run
    from macro_monitor.analytics.runctx import CutoffLockTimeout
    from macro_monitor.analytics.staleness import load_release_calendar

    cfg = _config(root)
    calendar_path = root / "config" / "release_calendar.yaml"
    calendar = load_release_calendar(calendar_path) if calendar_path.is_file() else {}
    with connect(_dsn(settings)) as conn:
        check_schema_version(conn)
        conn.rollback()
        ingest_id = args.ingest_run_id
        if ingest_id is None:
            row = conn.execute("SELECT max(run_id) FROM ingest.run").fetchone()
            conn.rollback()
            if row is None or row[0] is None:
                raise CliError("no ingest run exists; run fetch/load first")
            ingest_id = int(row[0])
        mapping_sha, overrides_sha = analytics_run.compute_hashes(conn)
        opt = analytics_run.AnalyzeOptions(
            ingest_run_id=ingest_id,
            as_of_run_date=args.as_of or datetime.now(UTC).date(),
            code_version=__version__,
            git_sha=settings.git_sha,
            config_asof=datetime.now(UTC),
            config_sha256=cfg.config_sha256,
            mapping_sha256=mapping_sha,
            overrides_sha256=overrides_sha,
            release_calendar=calendar,
        )
        try:
            res = analytics_run.analyze(conn, opt)
        except CutoffLockTimeout as exc:
            conn.rollback()
            print(f"analyze refused: {exc}", file=sys.stderr)
            return EXIT_PARTIAL
    print(
        f"analyze analysis_run_id={res.run.analysis_run_id}: snapshot={res.n_snapshot} "
        f"alerts={res.n_alerts} warnings={len(res.warnings)}"
    )
    for w in res.warnings:
        print(f"warning: {w}", file=sys.stderr)
    return EXIT_OK


def cmd_export(args: argparse.Namespace, settings: Settings, root: Path) -> int:
    """Export spec section 1: one ``mm_reader`` session; config read at the run's ``git_sha``."""
    from macro_monitor.publish import checks, export, meta, revisions, scorecard, series, status

    out = Path(args.out)
    out = out if out.is_absolute() else root / out
    generated = datetime.now(UTC)
    with connect(_dsn(settings)) as conn:
        check_schema_version(conn)
        conn.rollback()
        row = conn.execute(
            "SELECT git_sha FROM analytics.v_run_published WHERE ingest_run_id = %s "
            "ORDER BY analysis_run_id DESC LIMIT 1",
            [args.ingest_run_id],
        ).fetchone()
        conn.rollback()
        config = meta.ConfigTree.from_git(root, str(row[0])) if row else None
        producers: list[export.Producer] = []
        if config is not None:  # no analysis run: run_export fails EXP-10 and writes the status
            producers = [
                meta.meta_producer(config),
                scorecard.scorecard_producer,
                scorecard.alerts_producer,
                status.status_producer(config, generated_at=generated),
                series.series_producer,
                revisions.revisions_producer,
            ]
        res = export.run_export(
            conn, args.ingest_run_id, out, producers, now=lambda: generated,
            checker=checks.standard_checker(config), verify_determinism=True,
        )  # fmt: skip
    d = res.export_status
    print(
        f"export ok: analysis_run_id={d['analysis_run_id']} files={d['file_counts']['total']} "
        f"bytes={d['detail']['bytes_written']} warnings={len(d['detail']['warnings'])} -> {out}"
    )
    return EXIT_OK


def cmd_record_export(args: argparse.Namespace, settings: Settings, root: Path) -> int:
    from macro_monitor.publish import record

    path = Path(args.status_file)
    doc = record.load_status(path if path.is_absolute() else root / path)
    with connect(_dsn(settings)) as conn:
        check_schema_version(conn)
        conn.rollback()
        export_id = record.record_export(conn, doc)
    print(f"record-export ok: export_id={export_id} status={doc['status']}")
    return EXIT_OK


def cmd_check_site(args: argparse.Namespace, settings: Settings, root: Path) -> int:
    from macro_monitor.publish import checks

    site = Path(args.site_dir)
    site = site if site.is_absolute() else root / site
    if not site.is_dir():
        raise CliError("site directory does not exist")
    bad = checks.site_findings(site)
    for f in bad:
        print(f.text(), file=sys.stderr)
    return EXIT_PARTIAL if bad else EXIT_OK


def cmd_config_report(args: argparse.Namespace, settings: Settings, root: Path) -> int:
    cfg = _config(root)
    # Stub: offline coverage (every map entry counts as mapped); the DB-backed report is later.
    print(build_report(cfg, mapped=cfg.map_entries, pending=()).to_text())
    return EXIT_OK


def cmd_backup(args: argparse.Namespace, settings: Settings, root: Path) -> int:
    from macro_monitor.storage import dump, dump_check

    dump.require_public_profile(args.profile)
    out = Path(args.out)
    out = out if out.is_absolute() else root / out
    now = datetime.now(UTC)
    with connect(_dsn(settings)) as conn:
        check_schema_version(conn)
        conn.rollback()
        run_id = open_run(
            conn, workflow="backup", trigger=settings.trigger, mode="refresh",
            git_sha=settings.git_sha, code_version=__version__, started_at=now,
            gh_run_id=settings.gh_run_id, gh_run_attempt=settings.gh_run_attempt,
        )  # fmt: skip
        manifest = dump.write_dump(
            conn, out, ingest_run_id=run_id, git_sha=settings.git_sha,
            code_version=__version__, dump_id=f"db-dump-public-{now:%Y-%m}",
        )  # fmt: skip
        try:
            dump_check.assert_dump_ok(out)  # BKP-03: fail closed, no asset set remains
        except dump_check.DumpSelfCheckError:
            dump_check.discard_dump(out)
            close_run(conn, run_id, "failed")
            raise
        close_run(conn, run_id, "ok")
    totals = manifest["totals"]
    print(
        f"backup public: {manifest['dump_id']} files={totals['files']} rows={totals['rows']} "
        f"bytes_gz={totals['bytes_gz']} -> {out}"
    )
    return EXIT_OK


def cmd_restore_test(args: argparse.Namespace, settings: Settings, root: Path) -> int:
    from macro_monitor.storage import restore

    directory = Path(args.dir)
    directory = directory if directory.is_absolute() else root / directory
    result = restore.restore_test(directory, _dsn(settings), do_roundtrip=not args.no_roundtrip)
    rows = sum(result.tables.values())
    print(f"restore-test {result.dump_id}: tables={len(result.tables)} rows={rows} roundtrip="
          f"{'skipped' if result.roundtrip_mismatches is None else 'identical'}")  # fmt: skip
    return EXIT_OK


_COMMANDS = {
    "sync-config": cmd_sync_config,
    "migrate": cmd_migrate,
    "plan": cmd_plan,
    "fetch": cmd_fetch,
    "load": cmd_load,
    "decide": cmd_decide,
    "rebuild": cmd_rebuild,
    "ingest-manual": cmd_ingest_manual,
    "analyze": cmd_analyze,
    "export": cmd_export,
    "record-export": cmd_record_export,
    "check-site": cmd_check_site,
    "config-report": cmd_config_report,
    "backup": cmd_backup,
    "restore-test": cmd_restore_test,
}


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command is None:
        parser.print_help()
        return EXIT_OK
    root = (args.root or Path.cwd()).resolve()
    try:
        return int(_COMMANDS[args.command](args, Settings.from_env(), root))
    except CliError as exc:
        print(str(exc), file=sys.stderr)
        return exc.exit_code
    except (InputError, ConfigError) as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return EXIT_CONFIG_ERROR
    except DatabaseError as exc:
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        return int(exc.exit_code)
    except psycopg.Error as exc:
        print(f"database error: {type(exc).__name__}", file=sys.stderr)  # no DSN in the message
        return EXIT_DATABASE_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
