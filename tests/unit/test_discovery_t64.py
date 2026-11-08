"""T64 (ADR-028): landing-page discovery, offline. Pages are SYNTHETIC; patterns [UNVERIFIED]."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
import pytest

from macro_monitor.ingestion.base import GroupConfig
from macro_monitor.ingestion.connectors.bulk import MAX_LANDING_BYTES, BulkConnector
from macro_monitor.ingestion.connectors.sdmx import ConnectorConfigError, load_series_entries
from macro_monitor.ingestion.discovery import DiscoveryFailed, resolve_link
from macro_monitor.ingestion.http import HttpClient, HttpSettings, RetryConfig
from macro_monitor.models.types import ResolveSpec
from macro_monitor.registry.config import load_sources, validate_sources
from macro_monitor.storage.manifest import LatestState

pytestmark = pytest.mark.unit

ROOT = Path(__file__).resolve().parents[2]
PINK = ROOT / "tests" / "fixtures" / "raw" / "pinksheet" / "monthly_synthetic.xlsx"
LANDING = "https://www.worldbank.org/en/research/commodity-markets"
HASH_A = "74e8be41ceb20fa0da750cda2f6b9e4e-0050012026"
HASH_B = "0123456789abcdef0123456789abcdef-0050022026"
PATTERN = (
    r"^https://thedocs\.worldbank\.org/en/doc/[0-9a-f]{32}-[0-9]+/related/"
    r"CMO-Historical-Data-Monthly\.xlsx$"
)
HOSTS = ("www.worldbank.org", "thedocs.worldbank.org")
SPEC = ResolveSpec("CMO-Historical-Data-Monthly", PATTERN, 1, HOSTS, "xlsx")


def link(h: str, host: str = "thedocs.worldbank.org", scheme: str = "https") -> str:
    return f"{scheme}://{host}/en/doc/{h}/related/CMO-Historical-Data-Monthly.xlsx"


def page(*hrefs: str, extra: str = "") -> bytes:
    anchors = "".join(f'<a href="{h}">Monthly prices</a>' for h in hrefs)
    return f"<html><body>{extra}{anchors}</body></html>".encode()


def test_single_match_resolves() -> None:
    m = resolve_link(page(link(HASH_A)), LANDING, SPEC)
    assert m.resolved_url == link(HASH_A)


def test_zero_matches_fail() -> None:
    with pytest.raises(DiscoveryFailed):
        resolve_link(page("/en/other.xlsx"), LANDING, SPEC)


def test_two_distinct_matches_fail_but_duplicates_count_once() -> None:
    with pytest.raises(DiscoveryFailed):
        resolve_link(page(link(HASH_A), link(HASH_B)), LANDING, SPEC)
    assert resolve_link(page(link(HASH_A), link(HASH_A)), LANDING, SPEC).resolved_url == link(
        HASH_A
    )


def test_relative_and_protocol_relative_hrefs_resolve() -> None:
    rel = f"//thedocs.worldbank.org/en/doc/{HASH_A}/related/CMO-Historical-Data-Monthly.xlsx"
    assert resolve_link(page(rel), LANDING, SPEC).resolved_url == link(HASH_A)


def test_wrong_host_scheme_lookalike_and_extension_rejected() -> None:
    for bad in (
        link(HASH_A, "evil.example"),
        link(HASH_A, scheme="http"),
        link(HASH_A, "thedocs.worldbank.org.evil.example"),
        link(HASH_A).replace(".xlsx", ".csv"),
    ):
        with pytest.raises(DiscoveryFailed):
            resolve_link(page(bad), LANDING, SPEC)
    # pattern matches but the host is not on the allow-list
    loose = replace(SPEC, allowed_hosts=("www.worldbank.org",))
    with pytest.raises(DiscoveryFailed):
        resolve_link(page(link(HASH_A)), LANDING, loose)


def test_only_anchors_count() -> None:
    extra = f"<!-- {link(HASH_B)} --><script>var u='{link(HASH_B)}'</script><p>{link(HASH_B)}</p>"
    assert resolve_link(page(link(HASH_A), extra=extra), LANDING, SPEC).resolved_url == link(HASH_A)


def test_malformed_and_overlong_hrefs_are_skipped() -> None:
    long_href = link(HASH_B) + "?" + "a" * 2100
    html = page("http://[", "https://[::1", long_href, link(HASH_A))
    assert resolve_link(html, LANDING, SPEC).resolved_url == link(HASH_A)


def test_unexpected_exception_in_resolution_becomes_discovery_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import macro_monitor.ingestion.discovery as d

    def boom(*a: object) -> str:
        raise RuntimeError("unexpected")

    monkeypatch.setattr(d, "urljoin", boom)
    with pytest.raises(DiscoveryFailed, match="RuntimeError"):
        resolve_link(page(link(HASH_A)), LANDING, SPEC)


@pytest.mark.parametrize(
    "bad",
    [
        f"https://thedocs.worldbank.org@evil.example/en/doc/{HASH_A}/related/CMO-Historical-Data-Monthly.xlsx",
        f"https://allowed@evil.example/en/doc/{HASH_A}/related/CMO-Historical-Data-Monthly.xlsx",
        f"https://evil.example\\@thedocs.worldbank.org/en/doc/{HASH_A}/related/CMO-Historical-Data-Monthly.xlsx",
        f"https://thedocs.worldbank.org:8443/en/doc/{HASH_A}/related/CMO-Historical-Data-Monthly.xlsx",
        f"https://thedocs.worldbank.org\\en/doc/{HASH_A}/related/CMO-Historical-Data-Monthly.xlsx",
        f"https://thedocs.worldbank.org/en/doc/{HASH_A}/related/CMO-Historical-Data-Monthly.xlsx#x.csv",
        f"https://\uff54hedocs.worldbank.org/en/doc/{HASH_A}/related/CMO-Historical-Data-Monthly.xlsx",
        f"https://thedocs.worldb\u00e4nk.org/en/doc/{HASH_A}/related/CMO-Historical-Data-Monthly.xlsx",
        f"https://evilthedocs.worldbank.org/en/doc/{HASH_A}/related/CMO-Historical-Data-Monthly.xlsx",
        f"https://thedocs.worldbank.org.evil.example/en/doc/{HASH_A}/related/CMO-Historical-Data-Monthly.xlsx",
    ],
)
def test_url_tricks_are_not_resolved(bad: str) -> None:
    ok = bad.endswith(".xlsx#x.csv")
    if ok:  # a fragment is dropped, so this one is the legitimate file: control case
        assert resolve_link(page(bad), LANDING, SPEC).resolved_url == link(HASH_A)
        return
    with pytest.raises(DiscoveryFailed):
        resolve_link(page(bad), LANDING, SPEC)


def test_pattern_matching_is_fullmatch_and_ascii_digits() -> None:
    alt = replace(
        SPEC, link_pattern=r"^https://thedocs\.worldbank\.org/a$|^https://evil\.example/b$"
    )
    with pytest.raises(DiscoveryFailed):  # the validator rejects it; discovery still fullmatches
        resolve_link(page("https://evil.example/b/extra"), LANDING, alt)
    digits = replace(
        SPEC, link_pattern=r"^https://thedocs\.worldbank\.org/d/\d+$", allowed_hosts=HOSTS
    )
    assert resolve_link(page("https://thedocs.worldbank.org/d/12"), LANDING, digits)
    with pytest.raises(DiscoveryFailed):  # Arabic-Indic digits are not \d under re.ASCII
        resolve_link(page("https://thedocs.worldbank.org/d/\u0661\u0662"), LANDING, digits)


# ------------------------------------------------------------------ connector


class State:
    def __init__(self, latest: LatestState | None = None) -> None:
        self._l = latest or LatestState()

    def latest(self, source_id: str, request_key: str) -> LatestState:
        return self._l


class Clock:
    def monotonic(self) -> float:
        return 0.0

    def sleep(self, seconds: float) -> None:
        pass

    def wall(self) -> datetime:
        return datetime(2026, 11, 5, tzinfo=UTC)


def group() -> GroupConfig:
    conf = load_sources(ROOT / "config" / "sources.yaml")
    src = next(s for s in conf.data["sources"] if s["id"] == "worldbank_pinksheet")
    g = next(g for g in src["groups"] if g["id"] == "pinksheet_monthly")
    return GroupConfig.from_config(src, g, load_series_entries(ROOT / g["series_map"]))


def client(handler: Any) -> HttpClient:
    settings = HttpSettings(
        base_url="https://thedocs.worldbank.org/",
        retries=RetryConfig(max=0),
        extra_hosts=frozenset(HOSTS),
    )
    return HttpClient(
        settings,
        repo_url="https://example.invalid/repo",
        clock=Clock(),
        transport=httpx.MockTransport(handler),
    )


def site(hash_: str, body: bytes | None = None, seen: list[httpx.Request] | None = None) -> Any:
    def handler(req: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(req)
        if req.url.host == "www.worldbank.org":
            return httpx.Response(
                200, content=page(link(hash_)), headers={"Content-Type": "text/html"}
            )
        return httpx.Response(
            200,
            content=body if body is not None else PINK.read_bytes(),
            headers={"ETag": '"e1"', "Last-Modified": "Tue, 03 Nov 2026 10:00:00 GMT"},
        )

    return handler


def test_plan_is_offline_and_key_survives_real_rotation() -> None:
    g = group()
    (spec,) = BulkConnector(g.source_id).plan(g, State(), "refresh")
    assert spec.url == LANDING
    assert spec.resolve is not None
    assert spec.resolve.dataset == "CMO-Historical-Data-Monthly"
    assert spec.resolve.expect_format == "xlsx"
    # one landing page whose link hash changes between two fetches of the same logical spec
    current = {"hash": HASH_A}

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.host == "www.worldbank.org":
            return httpx.Response(
                200, content=page(link(current["hash"])), headers={"Content-Type": "text/html"}
            )
        return httpx.Response(200, content=PINK.read_bytes())

    conn = BulkConnector(g.source_id)
    first = conn.fetch(spec, client(handler), State())
    current["hash"] = HASH_B
    (replanned,) = conn.plan(g, State(), "refresh")  # same logical spec, planned again
    second = conn.fetch(replanned, client(handler), State())
    assert replanned.request_key == spec.request_key
    assert first.spec.request_key == second.spec.request_key == spec.request_key
    assert (first.resolved_url, second.resolved_url) == (link(HASH_A), link(HASH_B))


def test_fetch_resolves_records_discovery_and_rotation_keeps_key() -> None:
    g = group()
    conn = BulkConnector(g.source_id)
    (spec,) = conn.plan(g, State(), "refresh")
    seen: list[httpx.Request] = []
    a = conn.fetch(spec, client(site(HASH_A, seen=seen)), State())
    b = conn.fetch(spec, client(site(HASH_B)), State())
    assert [r.url.host for r in seen] == ["www.worldbank.org", "thedocs.worldbank.org"]
    assert (a.outcome, a.resolved_url) == ("new", link(HASH_A))
    assert b.resolved_url == link(HASH_B)
    assert a.spec.request_key == b.spec.request_key == spec.request_key
    assert a.body == b.body  # identical bytes: the content-hash rung treats it as unchanged
    d = a.discovery
    assert d is not None
    assert d["landing_url"] == LANDING
    assert d["resolved_url"] == link(HASH_A)
    assert d["matched_href"] == link(HASH_A)
    assert len(str(d["landing_sha256"])) == 64
    assert d["link_pattern_id"] == spec.resolve.pattern_id if spec.resolve else False


def test_validators_only_for_an_equal_resolved_url() -> None:
    g = group()
    conn = BulkConnector(g.source_id)
    (spec,) = conn.plan(g, State(), "refresh")
    sent: list[str | None] = []

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.host == "www.worldbank.org":
            return httpx.Response(
                200, content=page(link(HASH_A)), headers={"Content-Type": "text/html"}
            )
        sent.append(req.headers.get("If-None-Match"))
        return httpx.Response(200, content=PINK.read_bytes())

    conn.fetch(spec, client(handler), State(LatestState(etag='"e1"', last_url=link(HASH_A))))
    conn.fetch(spec, client(handler), State(LatestState(etag='"e1"', last_url=link(HASH_B))))
    assert sent == ['"e1"', None]


def test_discovery_failure_stores_nothing_and_never_falls_back() -> None:
    g = group()
    conn = BulkConnector(g.source_id)
    (spec,) = conn.plan(g, State(), "refresh")
    hosts: list[str | None] = []

    def handler(req: httpx.Request) -> httpx.Response:
        hosts.append(req.url.host)
        return httpx.Response(200, content=page("/nothing"), headers={"Content-Type": "text/html"})

    remembered = State(LatestState(etag='"e1"', last_url=link(HASH_A), raw_id=7))
    with pytest.raises(DiscoveryFailed) as ei:
        conn.fetch(spec, client(handler), remembered)
    assert ei.value.error_class == "discovery_failed"
    assert hosts == ["www.worldbank.org"]  # the remembered file URL is never requested


def test_landing_not_html_wrong_format_and_blocked() -> None:
    g = group()
    conn = BulkConnector(g.source_id)
    (spec,) = conn.plan(g, State(), "refresh")

    def not_html(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=page(link(HASH_A)), headers={"Content-Type": "text/plain"}
        )

    with pytest.raises(DiscoveryFailed):
        conn.fetch(spec, client(not_html), State())
    with pytest.raises(DiscoveryFailed):  # a file that is not a workbook
        conn.fetch(spec, client(site(HASH_A, body=b"<html>not a workbook</html>")), State())

    def challenge(req: httpx.Request) -> httpx.Response:
        return httpx.Response(403, content=b"<html>Just a moment... cf-chl</html>")

    res = conn.fetch(spec, client(challenge), State())
    assert res.outcome == "blocked"
    assert res.spec == spec  # ADR-005 class, not discovery_failed


def test_file_redirect_off_allow_list_is_refused() -> None:
    g = group()
    conn = BulkConnector(g.source_id)
    (spec,) = conn.plan(g, State(), "refresh")

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.host == "www.worldbank.org":
            return httpx.Response(
                200, content=page(link(HASH_A)), headers={"Content-Type": "text/html"}
            )
        return httpx.Response(302, headers={"Location": "https://evil.example/x.xlsx"})

    with pytest.raises(DiscoveryFailed) as ei:
        conn.fetch(spec, client(handler), State())
    assert ei.value.error_class == "discovery_failed"
    assert "redirect" in str(ei.value)


def test_transport_error_on_file_is_not_discovery_failed() -> None:
    g = group()
    conn = BulkConnector(g.source_id)
    (spec,) = conn.plan(g, State(), "refresh")

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.host == "www.worldbank.org":
            return httpx.Response(
                200, content=page(link(HASH_A)), headers={"Content-Type": "text/html"}
            )
        raise httpx.ConnectError("boom")

    res = conn.fetch(spec, client(handler), State())
    assert (res.outcome, res.status, res.body) == ("error", None, None)


def test_oversized_landing_page_is_refused() -> None:
    g = group()
    conn = BulkConnector(g.source_id)
    (spec,) = conn.plan(g, State(), "refresh")
    big = page(link(HASH_A), extra="x" * MAX_LANDING_BYTES)

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=big, headers={"Content-Type": "text/html"})

    with pytest.raises(DiscoveryFailed, match="too large"):
        conn.fetch(spec, client(handler), State())


def test_oversized_landing_page_is_refused_while_streaming() -> None:
    g = group()
    conn = BulkConnector(g.source_id)
    (spec,) = conn.plan(g, State(), "refresh")
    chunk, total = b"x" * 65536, 3 * 1024 * 1024
    consumed = 0

    def body() -> Any:
        nonlocal consumed
        for _ in range(total // len(chunk)):
            consumed += len(chunk)
            yield chunk

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, content=body(), headers={"Content-Type": "text/html"}
        )  # no Content-Length: only the streaming cap can stop it

    with pytest.raises(DiscoveryFailed, match="landing page too large"):
        conn.fetch(spec, client(handler), State())
    assert MAX_LANDING_BYTES < consumed < total
    assert consumed <= MAX_LANDING_BYTES + 2 * len(chunk)


def test_expect_matches_above_one_is_refused_at_plan() -> None:
    g = group()
    disc = {**dict(g.request_template["discover"]), "expect_matches": 2}
    bad = replace(g, request_template={**g.request_template, "discover": disc})
    with pytest.raises(ConnectorConfigError):
        BulkConnector(g.source_id).plan(bad, State(), "refresh")


# ------------------------------------------------------------------ config rule 44


def _doc() -> dict[str, Any]:
    conf = load_sources(ROOT / "config" / "sources.yaml")
    import copy

    return copy.deepcopy(conf.data)  # type: ignore[no-any-return]


def _issues(mutate: Any, source_id: str = "worldbank_pinksheet") -> list[str]:
    doc = _doc()
    src = next(s for s in doc["sources"] if s["id"] == source_id)
    mutate(src, src["groups"][0])
    return [f"{i.rule}:{i.message}" for i in validate_sources(doc)]  # rule 44 or the JSON schema


def test_rule_44_accepts_shipped_config() -> None:
    assert validate_sources(_doc()) == []


def _disc(**kw: Any) -> Any:
    return lambda s, g: g["request_template"]["discover"].update(**kw)


def _set_kind(kind: str) -> Any:
    return lambda s, g: s.update(kind=kind)


_PIN = r"^https://thedocs\.worldbank\.org/x"
NEGATIVES: list[tuple[Any, str]] = [
    (lambda s, g: g["request_template"].update(path="x/{dataset}.xlsx"), "exactly one of path"),
    (lambda s, g: g["request_template"].pop("discover"), "exactly one of path"),
    (lambda s, g: g["request_template"].pop("datasets"), "non-empty datasets"),
    (_set_kind("web"), "bulk only"),
    (_set_kind("manual"), "bulk only"),
    (_set_kind("sdmx"), "bulk only"),
    (_disc(link_pattern="[unclosed"), "does not compile"),
    (_disc(link_pattern=PATTERN.removeprefix("^")), "anchored"),
    (_disc(link_pattern=PATTERN.removesuffix("$")), "anchored"),
    (_disc(link_pattern=_PIN + r"\$"), "anchored"),
    (_disc(link_pattern=r"^http://thedocs\.worldbank\.org/x$"), "literal host"),
    (_disc(link_pattern=r"^https://.*\.worldbank\.org/x\.xlsx$"), "literal host"),
    (_disc(link_pattern=r"^https://\S*\.worldbank\.org/x$"), "literal host"),
    (_disc(link_pattern=r"^https://thedocs.worldbank.org/x$"), "literal host"),
    (_disc(link_pattern=r"^https://thedocs\.worldbank\.org\S*/x$"), "literal host"),
    (_disc(link_pattern=r"^https://other\.worldbank\.org/x$"), "must be in allowed_hosts"),
    (
        _disc(link_pattern=r"^https://thedocs\.worldbank\.org/a$|^https://evil\.example/b$"),
        "alternation",
    ),
    (_disc(expect_matches=0), "minimum"),
    (_disc(expect_matches=-1), "minimum"),
    (_disc(expect_matches=1.5), "integer"),
    (_disc(expect_matches=True), "integer"),
    (_disc(landing_url="http://www.worldbank.org/x"), "https"),
    (_disc(allowed_hosts=["https://a.org/"]), "bare host"),
    (_disc(allowed_hosts=["thedocs.worldbank.org"]), "landing_url must be in allowed_hosts"),
    (_disc(allowed_hosts=[]), "non-empty"),
    (lambda s, g: g["request_template"]["discover"].pop("allowed_hosts"), "required property"),
    (lambda s, g: s.update(base_url="https://elsewhere.example/"), "base_url must be in"),
]


@pytest.mark.parametrize(("mutate", "fragment"), NEGATIVES)
def test_rule_44_negatives(mutate: Any, fragment: str) -> None:
    doc = _doc()
    src = next(s for s in doc["sources"] if s["id"] == "worldbank_pinksheet")
    mutate(src, src["groups"][0])
    issues = [i for i in validate_sources(doc) if i.rule in ("44", "schema")]
    assert any(fragment in i.message for i in issues), [(i.rule, i.message) for i in issues]


def test_rule_44_escaped_backslash_before_real_dollar_is_anchored() -> None:
    mutate = _disc(link_pattern=r"^https://thedocs\.worldbank\.org/x\\$")
    assert [m for m in _issues(mutate) if "anchored" in m] == []


def test_two_datasets_on_a_discovered_group_are_refused_at_plan() -> None:
    g = group()
    bad = replace(g, request_template={**g.request_template, "datasets": ["a", "b"]})
    with pytest.raises(ConnectorConfigError):
        BulkConnector(g.source_id).plan(bad, State(), "refresh")


class _Gate:
    def __init__(self) -> None:
        self.checked: list[str] = []

    def check(self, source: Any, url: str) -> Any:
        from macro_monitor.ingestion.robots import RobotsDecision

        self.checked.append(url)
        if url == LANDING:
            return RobotsDecision(True, "log_only:allowed", False, None, None)
        return RobotsDecision(True, "log_only:disallowed", False, None, None, escalate=True)


def _run_fetch_request(
    monkeypatch: pytest.MonkeyPatch, handler: Any, gate: Any, state: Any | None = None
) -> tuple[Any, Any, Any]:
    from unittest.mock import MagicMock

    from macro_monitor.ingestion import archive, fetch

    g = group()
    conn = BulkConnector(g.source_id)
    (spec,) = conn.plan(g, State(), "refresh")
    job = fetch.GroupJob(
        source={"kind": "bulk"}, group=g, connector=conn, parser_id="pinksheet_v1@1"
    )
    seen: dict[str, Any] = {}
    fed = state or State()

    def record(c: Any, store: Any, result: Any, ctx: Any, *, stage: Any) -> Any:
        seen["result"], seen["ctx"] = result, ctx
        seen["params"] = archive.request_params(result)
        # stands in for manifest.latest_state (DB): prev id comes from the state fed in
        prev = fed.latest(result.spec.source_id, result.spec.request_key).raw_id
        seen["line"] = archive._manifest_line(result, ctx, 12, "0" * 64, False, None, prev)
        return archive.RecordOutcome("new", 12)

    monkeypatch.setattr(archive, "record_fetch", record)
    monkeypatch.setattr(archive, "collect_manifest_line", lambda store, outcome: None)
    monkeypatch.setattr(fetch, "default_filter", lambda group, s: (None, MagicMock()))
    report = fetch.GroupFetchReport(g.group_id)
    fetch._fetch_request(
        MagicMock(),
        MagicMock(),
        job,
        client(handler),
        1,
        spec,
        fed,
        gate,
        report,
    )
    return seen, report, spec


def test_robots_gate_covers_the_resolved_file_url(monkeypatch: pytest.MonkeyPatch) -> None:
    gate = _Gate()
    seen, report, _ = _run_fetch_request(monkeypatch, site(HASH_A), gate)
    assert gate.checked == [LANDING, link(HASH_A)]  # landing before, resolved URL after
    assert report.outcomes == ["new"]
    d = seen["result"].discovery
    assert d["landing_robots_decision"] == "log_only:allowed"
    assert d["file_robots_decision"] == "log_only:disallowed"
    assert seen["ctx"].robots_decision == "log_only:disallowed"  # the file's decision is stored


def test_ac_ing_23_unit_level_provenance(monkeypatch: pytest.MonkeyPatch) -> None:
    """Resolved URL, request_params.discovery and the manifest line's request_url, up to the DB.

    The prev_raw_id chain itself is NOT proven here: the stand-in for record_fetch reads the
    previous id from the ``LatestState`` this test feeds and the line only carries it through.
    The real chain (``manifest.latest_state`` -> prev_raw_id, and ``last_url`` read back from the
    stored ``request_url``) is covered by tests/integration/test_discovery_manifest_db.py."""
    first = LatestState(raw_id=11, last_url="https://old.example/x")
    seen, _, spec = _run_fetch_request(monkeypatch, site(HASH_A), _Gate(), State(first))
    res = seen["result"]
    assert res.resolved_url == link(HASH_A)
    assert res.spec.request_key == spec.request_key
    disc = seen["params"]["discovery"]
    assert seen["params"]["dataset"] == "CMO-Historical-Data-Monthly"
    for key in (
        "landing_url",
        "landing_status",
        "landing_sha256",
        "link_pattern_id",
        "matched_href",
        "resolved_url",
        "resolved_at",
    ):
        assert key in disc
    line = seen["line"]
    assert line["request_url"] == link(HASH_A)  # becomes last_url for the next run
    assert line["prev_raw_id"] == first.raw_id  # pass-through of the fed state only
    assert line["request_key"] == spec.request_key
    # next run: last_url == previous resolved URL -> validators are sent; a new URL -> none
    sent: list[str | None] = []

    def handler(req: httpx.Request) -> httpx.Response:
        if req.url.host == "www.worldbank.org":
            return httpx.Response(
                200, content=page(link(HASH_B)), headers={"Content-Type": "text/html"}
            )
        sent.append(req.headers.get("If-None-Match"))
        return httpx.Response(200, content=PINK.read_bytes())

    prev = LatestState(raw_id=12, etag='"e1"', last_url=line["request_url"])
    _run_fetch_request(monkeypatch, handler, _Gate(), State(prev))
    assert sent == [None]  # the link rotated: last_url differs, so no stale validators
