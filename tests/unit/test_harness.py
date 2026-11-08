"""Checks of the test harness itself: markers, socket blocking, console script."""

from __future__ import annotations

import socket

import pytest

from macro_monitor import __version__
from macro_monitor.cli import main
from macro_monitor.settings import Settings


def test_unit_tests_cannot_open_sockets() -> None:
    with pytest.raises(RuntimeError):
        socket.socket(socket.AF_INET, socket.SOCK_STREAM)


def test_cli_main_runs(capsys: pytest.CaptureFixture[str]) -> None:
    assert main([]) == 0
    assert "macro-monitor" in capsys.readouterr().out


def test_cli_version(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        main(["--version"])
    assert exc.value.code == 0
    assert __version__ in capsys.readouterr().out


def test_settings_from_env() -> None:
    assert Settings.from_env({}) == Settings(env="dev", raw_store=None)
    assert Settings.from_env({"MM_ENV": "prod", "MM_RAW_STORE": "x"}).raw_store == "x"
