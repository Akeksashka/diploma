"""CLI skeleton (T30): allow-list validation, exit codes, offline commands."""

from __future__ import annotations

from pathlib import Path

import pytest

from macro_monitor import cli
from macro_monitor.settings import (
    InputError,
    Settings,
    parse_group_id,
    parse_groups,
    parse_mode,
    parse_raw_id,
)

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "DATABASE_URL", "MM_ENV", "MM_RAW_STORE", "MM_GROUPS", "MM_MODE", "MM_RAW_ID",
        "GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_EVENT_NAME", "GITHUB_REPOSITORY",
    ):  # fmt: skip
        monkeypatch.delenv(name, raising=False)


def test_parse_groups_accepts_and_dedupes() -> None:
    assert parse_groups("") == ()
    assert parse_groups("a_1,b,,a_1") == ("a_1", "b")


@pytest.mark.parametrize("bad", ["A", "a b", "a;rm", "a$(x)", "a\nb", "a-b", "x" * 2001])
def test_parse_groups_rejects(bad: str) -> None:
    with pytest.raises(InputError):
        parse_groups(bad)


def test_other_allow_lists() -> None:
    assert parse_group_id("eurostat_labour") == "eurostat_labour"
    assert parse_raw_id("42") == 42
    assert parse_mode("catchup") == "catchup"
    for fn, bad in ((parse_group_id, "a,b"), (parse_raw_id, "-1"), (parse_raw_id, "1 "),
                    (parse_mode, "refresh;")):  # fmt: skip
        with pytest.raises(InputError):
            fn(bad)


def test_settings_from_env_validates_and_hides_dsn() -> None:
    s = Settings.from_env(
        {
            "DATABASE_URL": "postgresql://u:secret@h/db",
            "GITHUB_SHA": "not-a-sha",
            "GITHUB_EVENT_NAME": "workflow_dispatch",
            "GITHUB_RUN_ID": "12",
            "GITHUB_REPOSITORY": "o/r",
        }
    )
    assert "secret" not in repr(s)
    assert (s.git_sha, s.trigger, s.gh_run_id, s.repo_url) == (
        "unknown", "dispatch", 12, "https://github.com/o/r",
    )  # fmt: skip


def test_no_command_prints_help(capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main([]) == 0
    assert "usage" in capsys.readouterr().out


@pytest.mark.parametrize(
    "argv",
    [
        ["fetch", "--group", "Bad;Group"],
        ["load", "--groups", "a b"],
        ["load", "--raw-id", "x"],
        ["plan", "--mode", "nope"],
        ["plan", "--root", "/does/not/exist"],
        ["bogus"],
    ],
)
def test_bad_arguments_exit_20(argv: list[str]) -> None:
    with pytest.raises(SystemExit) as info:
        cli.main(argv)
    assert info.value.code == cli.EXIT_CONFIG_ERROR


def test_env_group_list_is_validated(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MM_GROUPS", "a;b")
    assert cli.main(["load", "--root", str(ROOT)]) == 20


def test_load_refuses_local_dir_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MM_ENV", "production")
    monkeypatch.setenv("MM_RAW_STORE", "local_dir")
    assert cli.main(["load", "--root", str(ROOT)]) == 20


def test_plan_refuses_local_dir_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MM_ENV", "production")
    monkeypatch.setenv("MM_RAW_STORE", "local_dir")
    assert cli.main(["plan", "--root", str(ROOT)]) == 20


def test_missing_database_url_is_config_error() -> None:
    assert cli.main(["plan", "--root", str(ROOT)]) == 20
    assert cli.main(["migrate", "--root", str(ROOT)]) == 20


def test_config_error_exits_20(tmp_path: Path) -> None:
    assert cli.main(["config-report", "--root", str(tmp_path)]) == 20


def test_unknown_group_exits_20(monkeypatch: pytest.MonkeyPatch) -> None:
    assert cli.main(["fetch", "--group", "no_such_group", "--root", str(ROOT)]) == 20
    monkeypatch.setenv("MM_GROUPS", "no_such_group")
    assert cli.main(["load", "--root", str(ROOT)]) == 20


def test_config_report_stub(capsys: pytest.CaptureFixture[str]) -> None:
    assert cli.main(["config-report", "--root", str(ROOT)]) == 0
    assert "indicator" in capsys.readouterr().out


@pytest.mark.parametrize("bad", ["2026-13-01", "tomorrow", "2026-01-01; rm", "$(x)"])
def test_analyze_rejects_bad_as_of(bad: str) -> None:
    with pytest.raises(SystemExit) as exc:
        cli.main(["analyze", "--as-of", bad, "--root", str(ROOT)])
    assert exc.value.code == 20


@pytest.mark.parametrize("bad", ["abc", "1;2", "-"])
def test_analyze_rejects_bad_ingest_run_id(bad: str) -> None:
    with pytest.raises(SystemExit) as exc:
        cli.main(["analyze", "--ingest-run-id", bad, "--root", str(ROOT)])
    assert exc.value.code == 20


def test_analyze_without_database_url_exits_20() -> None:
    assert cli.main(["analyze", "--as-of", "2026-01-31", "--root", str(ROOT)]) == 20


@pytest.mark.parametrize(
    ("source_id", "cls_name"),
    [
        ("eurostat", "EurostatConnector"),
        ("worldbank", "WorldBankConnector"),
        ("bis", "BulkConnector"),
        ("ecb", "EcbConnector"),
    ],
)
def test_connector_dispatch(source_id: str, cls_name: str) -> None:
    assert type(cli._connector({"id": source_id})).__name__ == cls_name


def test_connector_dispatch_unknown_source() -> None:
    with pytest.raises(cli.CliError, match="no connector for source 'nope'"):
        cli._connector({"id": "nope"})


def test_every_fetchable_config_group_has_a_connector_and_series_loader() -> None:
    cfg = cli._config(ROOT)
    for source, group in cli._groups_of(cfg, enabled_only=False):
        if source.get("kind") == "manual":
            continue
        cli._connector(source)
        assert cli._series_for(source, ROOT / group["series_map"])


def test_fetch_summary_lists_deferred_and_skipped_requests(
    capsys: pytest.CaptureFixture[str],
) -> None:
    from macro_monitor.ingestion.fetch import FetchRunReport, GroupFetchReport

    report = FetchRunReport(
        run_id=1,
        status="partial",
        groups=[
            GroupFetchReport("g1", outcomes=["new", "rate_limited"], deferred=["k2", "k3"]),
            GroupFetchReport("g2", outcomes=["blocked"], skipped=["k9"]),
            GroupFetchReport("g3", outcomes=["new"]),
        ],
    )
    cli._print_fetch_summary(report)
    lines = capsys.readouterr().out.splitlines()
    assert lines == [
        "fetch g1: outcomes=['new', 'rate_limited'] error=None",
        "  deferred to catch-up (2): k2, k3",
        "fetch g2: outcomes=['blocked'] error=None",
        "  skipped after a block (1): k9",
        "fetch g3: outcomes=['new'] error=None",
    ]
