"""T49 `decide` argument handling: allow-lists and exit code 20 (no database)."""

from __future__ import annotations

import pytest

from macro_monitor import cli
from macro_monitor.settings import InputError


@pytest.mark.parametrize("text", ["accepted", "rejected", "skip_object", "exclude", "include"])
def test_decisions_allowed(text: str) -> None:
    assert cli.parse_decision(text) == text


@pytest.mark.parametrize("bad", ["", "accept; rm", "ACCEPTED", "drop"])
def test_decisions_refused(bad: str) -> None:
    with pytest.raises(InputError):
        cli.parse_decision(bad)


def test_actor_note_timestamp_allow_lists() -> None:
    assert cli.parse_actor("alina-d") == "alina-d"
    for bad in ("", "-x", "a b", "a;b", "$(id)", "x" * 40):
        with pytest.raises(InputError):
            cli.parse_actor(bad)
    assert cli.parse_note("Reviewed: base year rebased (2015=100).")
    for bad in ("", "x\ny", "`id`", "$(id)", "a" * 501):
        with pytest.raises(InputError):
            cli.parse_note(bad)
    assert cli.parse_timestamp("2026-10-01T06:00:00Z").utcoffset() is not None
    with pytest.raises(InputError):
        cli.parse_timestamp("2026-10-01")


@pytest.mark.parametrize(
    "argv",
    [
        ["decide", "--kind", "drift", "--decision", "bogus", "--event-id", "1"],
        ["decide", "--kind", "drift", "--decision", "accepted", "--event-id", "x"],
        ["decide", "--decision", "accepted"],
    ],
)
def test_bad_arguments_exit_20(argv: list[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        cli.main(argv)
    assert exc.value.code == cli.EXIT_CONFIG_ERROR


def test_mismatched_kind_and_decision_exit_20(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GITHUB_ACTOR", "alina")
    rc = cli.main(["decide", "--kind", "override", "--decision", "accepted", "--event-id", "1"])
    assert rc == cli.EXIT_CONFIG_ERROR
    rc = cli.main(["decide", "--kind", "drift", "--decision", "accepted"])
    assert rc == cli.EXIT_CONFIG_ERROR
