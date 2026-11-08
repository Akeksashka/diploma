"""Loader and validation rules for ``config/sources.yaml`` (T07).

Source of truth: ``docs/specs/source-config-schema.md`` sections 1 and 2, validation rules
1-7, 9, 10, 11 (reminders), 15-19, 27, 28 and 30-32 (the keys of the ``revision:`` block).
Shape and unknown keys are checked by ``schemas/sources.schema.json`` (JSON Schema 2020-12);
cross-field rules are checked here. Every issue carries the rule number it belongs to.
"""

from __future__ import annotations

import importlib
import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date
from importlib import resources
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import yaml
from jsonschema import Draft202012Validator

#: Day of the month on which the ``preflight`` workflow runs (cron ``41 5 25 * *``; rule 11).
PREFLIGHT_DAY = 25
#: Maximum age of a ``terms_review`` for a ``web`` source, days (rule 1).
TERMS_REVIEW_MAX_AGE_DAYS = 365
AUTOMATED_KINDS = frozenset({"sdmx", "rest", "bulk", "web"})
#: ``kind: web`` defaults of rule 4.
WEB_RATE_LIMIT_DEFAULTS: dict[str, int] = {
    "min_interval_s": 5,
    "max_concurrent": 1,
    "max_requests_per_run": 100,
}
#: Keys that a manual source must not carry (rule 4).
MANUAL_FORBIDDEN_KEYS = ("rate_limit", "http", "change_detection", "base_url", "auth")


@dataclass(frozen=True)
class ConfigIssue:
    """One validation finding. ``rule`` is a spec rule number, or ``schema`` for shape errors."""

    rule: str
    path: str
    message: str

    def __str__(self) -> str:
        label = f"rule {self.rule}" if self.rule != "schema" else "schema"
        return f"[{label}] {self.path}: {self.message}"


class ConfigError(ValueError):
    """Raised by the loader when a config file has validation errors."""

    def __init__(self, issues: Sequence[ConfigIssue]) -> None:
        self.issues = tuple(issues)
        super().__init__("\n".join(str(i) for i in self.issues))


@dataclass(frozen=True)
class SourcesConfig:
    """A validated ``sources.yaml``.

    ``effective_enabled`` maps source id to ``enabled`` after rule 1 (a web source without a
    current review is forced off); ``skipped_review`` lists those forced off (``plan`` reports
    them as ``skipped_review``).
    """

    data: Mapping[str, Any]
    effective_enabled: Mapping[str, bool]
    skipped_review: tuple[str, ...] = ()
    warnings: tuple[ConfigIssue, ...] = field(default=())
    #: ``(source_id, group_id)`` -> effective state = effective source state AND the group's own
    #: ``enabled`` (default true); rule 45 / ADR-027. Empty when built without groups.
    effective_group_enabled: Mapping[tuple[str, str], bool] = field(default_factory=dict)

    def group_off_reason(self, source_id: str, group_id: str) -> str | None:
        """None when the group is enabled, else which switch is off (source and/or group)."""
        if self.effective_group_enabled.get((source_id, group_id), True):
            return None
        reasons: list[str] = []
        if not self.effective_enabled[source_id]:
            reasons.append(f"source switch (source {source_id!r} is not enabled)")
        own = {
            g["id"]: g.get("enabled", True)
            for s in self.data["sources"]
            if s["id"] == source_id
            for g in s.get("groups") or []
        }
        if not own.get(group_id, True):
            reasons.append(f"group switch (group {group_id!r} has enabled: false)")
        return " and ".join(reasons)


# --------------------------------------------------------------------------------------
# YAML and schema
# --------------------------------------------------------------------------------------


class _Loader(yaml.SafeLoader):  # type: ignore[misc]
    """Safe loader with YAML 1.2 booleans and ISO dates kept as ``YYYY-MM-DD`` strings.

    PyYAML follows YAML 1.1, where ``on``, ``off``, ``yes``, ``no`` are booleans; the spec writes
    ``retries: {on: [...]}`` and entity codes such as ``NO`` must stay strings, so only
    ``true``/``false`` are booleans here. The schema validates dates as dates.
    """


_BOOL_TAG = "tag:yaml.org,2002:bool"
_TIMESTAMP_TAG = "tag:yaml.org,2002:timestamp"
_BOOL_RE = re.compile(r"^(?:true|True|TRUE|false|False|FALSE)$")
_Loader.yaml_implicit_resolvers = {
    key: [
        (tag, _BOOL_RE if tag == _BOOL_TAG else rx)
        for tag, rx in resolvers
        if tag != _TIMESTAMP_TAG
    ]
    for key, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}


def load_yaml(path: Path) -> Any:
    """Parse a YAML file with dates kept as ``YYYY-MM-DD`` strings."""
    with path.open(encoding="utf-8") as fh:
        return yaml.load(fh, Loader=_Loader)


def load_yaml_text(text: str) -> Any:
    """Parse YAML text like :func:`load_yaml` (used for config read from a git object)."""
    return yaml.load(text, Loader=_Loader)


def sources_schema() -> dict[str, Any]:
    """The JSON schema shipped as package data of ``macro_monitor.registry``."""
    text = (
        resources.files("macro_monitor.registry")
        .joinpath("schemas/sources.schema.json")
        .read_text(encoding="utf-8")
    )
    schema: dict[str, Any] = json.loads(text)
    return schema


def _jpath(parts: Sequence[object]) -> str:
    out = ""
    for p in parts:
        out += f"[{p}]" if isinstance(p, int) else (f".{p}" if out else str(p))
    return out or "<root>"


def _schema_issues(data: object) -> list[ConfigIssue]:
    validator = Draft202012Validator(
        sources_schema(), format_checker=Draft202012Validator.FORMAT_CHECKER
    )
    issues = [
        ConfigIssue("schema", _jpath(list(e.absolute_path)), e.message)
        for e in sorted(validator.iter_errors(data), key=lambda e: list(map(str, e.absolute_path)))
    ]
    return issues


# --------------------------------------------------------------------------------------
# Env names documented in .env.example (rule 3, AC-CFG-3)
# --------------------------------------------------------------------------------------

_ENV_NAME = re.compile(r"^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=")


def env_example_names(text: str) -> frozenset[str]:
    """Variable names documented in ``.env.example`` text (``NAME=`` or ``# NAME=``)."""
    return frozenset(m.group(1) for line in text.splitlines() if (m := _ENV_NAME.match(line)))


# --------------------------------------------------------------------------------------
# Cross-field rules
# --------------------------------------------------------------------------------------


def _parse_date(value: object) -> date | None:
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None


def web_review_ok(source: Mapping[str, Any], today: date) -> bool:
    """Rule 1: a web source may run only with a current permitted terms and robots review."""
    terms = source.get("terms_review")
    robots = source.get("robots_review")
    if not isinstance(terms, Mapping) or not isinstance(robots, Mapping):
        return False
    reviewed = _parse_date(terms.get("reviewed_on"))
    return (
        terms.get("decision") == "permitted"
        and reviewed is not None
        and 0 <= (today - reviewed).days <= TERMS_REVIEW_MAX_AGE_DAYS
        and robots.get("decision") == "permitted"
    )


def _source_issues(
    s: Mapping[str, Any],
    idx: int,
    *,
    private_repo: str | None,
    env_names: frozenset[str] | None,
    project_root: Path | None,
    check_parsers: bool,
) -> list[ConfigIssue]:
    out: list[ConfigIssue] = []
    base = f"sources[{idx}]({s.get('id')})"

    def add(rule: str, sub: str, msg: str) -> None:
        out.append(ConfigIssue(rule, f"{base}{sub}", msg))

    kind = s.get("kind")
    licence = s.get("licence") or {}
    redistribution = licence.get("redistribution_of_raw")
    archive = s.get("archive")
    publish = s.get("publish_site")

    # Rule 2
    if s.get("automated_access") == "manual_only" and kind != "manual":
        add("2", ".automated_access", "automated_access: manual_only requires kind: manual")

    # Rule 3 (documented env names; presence at plan time is check_env_present)
    auth = s.get("auth")
    if isinstance(auth, Mapping) and auth.get("type") not in (None, "none"):
        env = auth.get("env")
        if env_names is not None and env not in env_names:
            add("3", ".auth.env", f"env var {env!r} is not documented in .env.example")

    # Rule 4
    if kind == "manual":
        for key in MANUAL_FORBIDDEN_KEYS:
            if key in s:
                add(
                    "4", f".{key}", f"a manual source must not carry {key!r} (nothing would use it)"
                )
    elif kind in AUTOMATED_KINDS:
        rl = dict(s.get("rate_limit") or {})
        if kind == "web":
            for k, v in WEB_RATE_LIMIT_DEFAULTS.items():
                rl.setdefault(k, v)
        has_budget = rl.get("budget_per_hour") is not None or rl.get("budget_per_day") is not None
        if rl.get("min_interval_s") is None and not has_budget:
            add("4", ".rate_limit", "rate_limit must define min_interval_s or a budget")

    # Rule 5
    if archive == "public" and redistribution == "forbidden":
        add("5", ".archive", "archive: public is rejected when redistribution_of_raw is forbidden")
    if redistribution == "unclear":
        if archive == "private":
            add("5", ".archive", "unclear licence: archive private is not allowed")
        elif archive == "public" and "user_decision" not in licence:
            add(
                "5",
                ".archive",
                "unclear licence: archive public needs licence.user_decision {by, on, rationale}",
            )

    # Rule 15
    if publish == "public" and redistribution == "forbidden":
        add(
            "15",
            ".publish_site",
            "publish_site: public is rejected when redistribution is forbidden",
        )

    # Rule 17
    if archive == "private" and private_repo is None:
        add(
            "17",
            ".archive",
            "archive: private is rejected while archive_policy.private_repo is null",
        )

    # Rule 11 (reminders)
    months: set[int] = set()
    for g in s.get("groups") or []:
        months.update((g.get("freshness") or {}).get("release_months") or [])
    for r_i, rem in enumerate(s.get("reminders") or []):
        win, on = rem["expected_window"], rem["remind_on"]
        rp = f".reminders[{r_i}]"
        if on["month"] not in months:
            add("11", rp, "remind_on.month is not in freshness.release_months of the source")
        if win["month"] != on["month"]:
            add("11", rp, "remind_on.month must equal expected_window.month")
        if win["from_day"] > win["to_day"]:
            add("11", rp, "expected_window.from_day must not exceed to_day")
        if not win["to_day"] < on["day"] <= PREFLIGHT_DAY:
            add(
                "11",
                rp,
                f"remind_on.day must satisfy expected_window.to_day < day <= {PREFLIGHT_DAY}",
            )

    # Rule 18 (edition_ordered groups: inbox sidecars carry edition_label and edition_date)
    inbox = s.get("inbox") or {}
    for g in s.get("groups") or []:
        if not g.get("edition_ordered"):
            continue
        gp = f".groups({g.get('id')})"
        if kind != "manual":
            add("18", gp, "edition_ordered: true requires a source with kind: manual")
        req = set(inbox.get("sidecar_required") or [])
        for key in ("edition_label", "edition_date"):
            if key not in req:
                add("18", ".inbox.sidecar_required", f"edition_ordered group needs {key!r}")
        bad = set(inbox.get("sidecar_optional") or []) - {"licence_note", "import_label"}
        if bad:
            add("18", ".inbox.sidecar_optional", f"unknown sidecar keys: {sorted(bad)}")

    for g_i, g in enumerate(s.get("groups") or []):
        for issue in discover_issues(s, g):
            out.append(
                ConfigIssue("44", f"{base}.groups[{g_i}]({g.get('id')}){issue[0]}", issue[1])
            )
        out.extend(
            _group_issues(
                g,
                f"{base}.groups[{g_i}]({g.get('id')})",
                project_root=project_root,
                check_parsers=check_parsers,
            )
        )
    return out


_HOST_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9.-]*$")
# ^https:// then a literal escaped host (letters, digits, '-', labels joined by an escaped dot),
# then '/' or '$'
_PATTERN_HEAD_RE = re.compile(r"^\^https://((?:[A-Za-z0-9-]+\\\.)*[A-Za-z0-9-]+)(?=/|\$$)")


def _ends_with_escaped_dollar(pattern: str) -> bool:
    """True if the final ``$`` is a literal (preceded by an odd number of backslashes)."""
    body = pattern[:-1]
    return (len(body) - len(body.rstrip("\\"))) % 2 == 1


def _has_top_level_alternation(pattern: str) -> bool:
    """A ``|`` outside every group and character class (it would escape the anchors)."""
    depth = 0
    in_class = False
    i = 0
    while i < len(pattern):
        c = pattern[i]
        if c == "\\":
            i += 2
            continue
        if in_class:
            in_class = c != "]"
        elif c == "[":
            in_class = True
            if pattern[i + 1 : i + 2] == "^":
                i += 1
            if pattern[i + 1 : i + 2] == "]":
                i += 1
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        elif c == "|" and depth == 0:
            return True
        i += 1
    return False


def discover_issues(s: Mapping[str, Any], g: Mapping[str, Any]) -> list[tuple[str, str]]:
    """Rule 44 (ADR-028): ``request_template.discover`` of a bulk group, as (subpath, message)."""
    tpl = g.get("request_template") or {}
    disc = tpl.get("discover")
    out: list[tuple[str, str]] = []
    if s.get("kind") == "bulk":
        if ("path" in tpl) == (disc is not None):
            out.append((".request_template", "a bulk group has exactly one of path and discover"))
        if disc is not None and not tpl.get("datasets"):
            out.append((".request_template.datasets", "discover needs a non-empty datasets list"))
    if disc is None:
        return out
    sub = ".request_template.discover"
    if s.get("kind") != "bulk":
        return [*out, (sub, "discover is allowed on kind: bulk only")]
    if not isinstance(disc, Mapping):
        return [*out, (sub, "discover must be a mapping")]
    landing = str(disc.get("landing_url") or "")
    lparts = urlsplit(landing)
    if lparts.scheme != "https" or not lparts.hostname:
        out.append((sub + ".landing_url", "landing_url must be an https URL"))
    hosts = disc.get("allowed_hosts")
    host_list = [str(h) for h in hosts] if isinstance(hosts, list) else []
    if not host_list or any(not _HOST_RE.match(h) for h in host_list):
        out.append((sub + ".allowed_hosts", "allowed_hosts: non-empty list of bare host names"))
    else:
        if lparts.hostname and lparts.hostname not in host_list:
            out.append((sub + ".allowed_hosts", "the host of landing_url must be in allowed_hosts"))
        base_host = urlsplit(str(s.get("base_url") or "")).hostname
        if base_host and base_host not in host_list:
            out.append((sub + ".allowed_hosts", "the host of base_url must be in allowed_hosts"))
    expect = disc.get("expect_matches", 1)
    if isinstance(expect, bool) or not isinstance(expect, int) or expect < 1:
        out.append((sub + ".expect_matches", "expect_matches must be a positive integer"))
    pattern = disc.get("link_pattern")
    if not isinstance(pattern, str):
        out.append((sub + ".link_pattern", "link_pattern is required"))
        return out
    try:
        re.compile(pattern, re.ASCII)
    except re.error as exc:
        return [*out, (sub + ".link_pattern", f"link_pattern does not compile: {exc}")]
    if (
        not pattern.startswith("^")
        or not pattern.endswith("$")
        or _ends_with_escaped_dollar(pattern)
    ):
        out.append((sub + ".link_pattern", "link_pattern must be anchored (^...$)"))
    if _has_top_level_alternation(pattern):
        out.append((sub + ".link_pattern", "link_pattern must not have a top-level alternation"))
    m = _PATTERN_HEAD_RE.match(pattern)
    if m is None:
        out.append((sub + ".link_pattern", "link_pattern must start ^https://<literal host>/"))
    elif host_list and m.group(1).replace("\\.", ".").lower() not in {h.lower() for h in host_list}:
        out.append(
            (sub + ".link_pattern", "the literal host of link_pattern must be in allowed_hosts")
        )
    return out


def _group_issues(
    g: Mapping[str, Any], base: str, *, project_root: Path | None, check_parsers: bool
) -> list[ConfigIssue]:
    out: list[ConfigIssue] = []

    def add(rule: str, sub: str, msg: str) -> None:
        out.append(ConfigIssue(rule, f"{base}{sub}", msg))

    rev = g.get("revision") or {}
    reest = bool(g.get("reestimating", False))
    edition = bool(g.get("edition_ordered", False))
    snapshot = rev.get("snapshot_mode")

    # Rule 6 (opt-in: parsers do not exist until the connector tasks)
    if check_parsers:
        problem = _parser_problem(str(g["parser"]))
        if problem:
            add("6", ".parser", problem)

    # Rule 7 (file existence needs a project root)
    if project_root is not None and not (project_root / str(g["series_map"])).is_file():
        add("7", ".series_map", f"series_map file {g['series_map']!r} does not exist")

    # Rule 9
    if g.get("mode_default") == "incremental" and g.get("fetch_scope") != "partial":
        add("9", ".fetch_scope", "mode_default: incremental requires fetch_scope: partial")

    # Rule 10
    if rev.get("compare") == "fixed_decimals" and rev.get("decimals") is None:
        add("10", ".revision.decimals", "revision.compare: fixed_decimals requires decimals")
    if reest:
        if rev.get("max_revised_rows") is None:
            add("10", ".revision.max_revised_rows", "reestimating: true requires max_revised_rows")
        if not g.get("note"):
            add("10", ".note", "reestimating: true requires a note naming the re-estimation family")

    # Rule 27
    if reest and edition:
        add("27", "", "edition_ordered: true and reestimating: true are mutually exclusive")
    if edition:
        if rev.get("max_revised_rows") is not None:
            add(
                "27",
                ".revision.max_revised_rows",
                "an edition_ordered group sets no max_revised_rows",
            )
        if snapshot not in (None, "none"):
            add(
                "27", ".revision.snapshot_mode", "an edition_ordered group needs snapshot_mode none"
            )

    # Rule 31 (rule 27 covers the edition_ordered case above)
    if snapshot == "diff_above_tol" and not reest and not edition:
        add("31", ".revision.snapshot_mode", "diff_above_tol requires reestimating: true")
    return out


def _parser_problem(spec: str) -> str | None:
    module_name, _, func = spec.partition(":")
    try:
        module = importlib.import_module(module_name)
    except ImportError as exc:
        return f"parser module {module_name!r} is not importable ({exc})"
    if not callable(getattr(module, func, None)):
        return f"parser {spec!r} is not a callable"
    if not hasattr(module, "PARSER_VERSION"):
        return f"parser module {module_name!r} has no PARSER_VERSION"
    return None


def validate_sources(
    data: object,
    *,
    env_names: frozenset[str] | None = None,
    project_root: Path | None = None,
    check_parsers: bool = False,
    today: date | None = None,
) -> list[ConfigIssue]:
    """Validate parsed ``sources.yaml`` content; returns all issues (empty means valid).

    ``env_names``: names documented in ``.env.example`` (rule 3); skipped when ``None``.
    ``project_root``: base for ``series_map`` paths (rule 7 file existence); skipped when ``None``.
    ``check_parsers``: import every ``parser`` (rule 6); off by default because the parser
    modules arrive with the connector tasks. ``today`` is unused by validation itself (rule 1
    does not make a file invalid) and accepted for symmetry with :func:`load_sources`.
    """
    del today
    issues = _schema_issues(data)
    if issues:
        return issues
    assert isinstance(data, Mapping)
    private_repo = data["archive_policy"]["private_repo"]
    seen_sources: set[str] = set()
    for i, s in enumerate(data["sources"]):
        if s["id"] in seen_sources:
            issues.append(ConfigIssue("schema", f"sources[{i}].id", f"duplicate id {s['id']!r}"))
        seen_sources.add(s["id"])
        seen_groups: set[str] = set()
        for j, g in enumerate(s["groups"]):
            if g["id"] in seen_groups:
                issues.append(
                    ConfigIssue(
                        "schema", f"sources[{i}].groups[{j}].id", f"duplicate id {g['id']!r}"
                    )
                )
            seen_groups.add(g["id"])
        issues.extend(
            _source_issues(
                s,
                i,
                private_repo=private_repo,
                env_names=env_names,
                project_root=project_root,
                check_parsers=check_parsers,
            )
        )
    return issues


def check_env_present(config: SourcesConfig, environ: Mapping[str, str]) -> list[ConfigIssue]:
    """Rule 3, plan time: an enabled source whose auth env var is unset fails ``plan``."""
    out: list[ConfigIssue] = []
    for i, s in enumerate(config.data["sources"]):
        auth = s.get("auth")
        # rule 3 as narrowed by rule 45: only a source with at least one enabled group needs it
        if (
            config.effective_enabled[s["id"]]
            and any(
                config.effective_group_enabled.get((s["id"], g["id"]), True)
                for g in s.get("groups") or []
            )
            and isinstance(auth, Mapping)
            and auth.get("type") not in (None, "none")
            and not environ.get(auth["env"])
        ):
            out.append(
                ConfigIssue("3", f"sources[{i}]({s['id']}).auth.env", f"{auth['env']} is not set")
            )
    return out


def load_sources(
    path: Path,
    *,
    env_example: Path | None = None,
    project_root: Path | None = None,
    check_parsers: bool = False,
    today: date | None = None,
) -> SourcesConfig:
    """Load and validate ``sources.yaml``; raises :class:`ConfigError` on any issue."""
    data = load_yaml(path)
    env_names = env_example_names(env_example.read_text(encoding="utf-8")) if env_example else None
    issues = validate_sources(
        data, env_names=env_names, project_root=project_root, check_parsers=check_parsers
    )
    if issues:
        raise ConfigError(issues)
    run_date = today or date.today()
    enabled: dict[str, bool] = {}
    group_enabled: dict[tuple[str, str], bool] = {}
    skipped: list[str] = []
    warnings: list[ConfigIssue] = []
    for i, s in enumerate(data["sources"]):
        on = bool(s["enabled"])
        if s["kind"] == "web" and on and not web_review_ok(s, run_date):
            on = False
            skipped.append(s["id"])
        enabled[s["id"]] = on
        groups = s.get("groups") or []
        for j, g in enumerate(groups):
            own = bool(g.get("enabled", True))
            group_enabled[(s["id"], g["id"])] = on and own
            if not own and not g.get("note"):
                warnings.append(
                    ConfigIssue(
                        "45",
                        f"sources[{i}]({s['id']}).groups[{j}]({g['id']}).note",
                        "enabled: false without a note naming the reason and the probe",
                    )
                )
        if on and groups and not any(group_enabled[(s["id"], g["id"])] for g in groups):
            warnings.append(
                ConfigIssue("45", f"sources[{i}]({s['id']})", "source enabled, no group enabled")
            )
    return SourcesConfig(data, enabled, tuple(skipped), tuple(warnings), group_enabled)


# --------------------------------------------------------------------------------------
# Rule 28 (indicator inputs; the indicators.yaml schema itself is a later task)
# --------------------------------------------------------------------------------------


def indicator_input_issues(indicator: Mapping[str, Any]) -> list[ConfigIssue]:
    """Rule 28 / AC-CFG-10: ``inputs[].annualised_policy`` takes only ``fail`` (or is absent)."""
    out: list[ConfigIssue] = []
    for i, inp in enumerate(indicator.get("inputs") or []):
        policy = inp.get("annualised_policy", "fail")
        if policy != "fail":
            out.append(
                ConfigIssue(
                    "28",
                    f"indicators({indicator.get('id')}).inputs[{i}].annualised_policy",
                    f"{policy!r} is not allowed; only 'fail' (latest_single is rejected)",
                )
            )
    return out
