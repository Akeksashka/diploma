"""Loader A unit tests: direct-endpoint guard and status sets (no database)."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, cast

import pytest

from macro_monitor.storage import loader
from macro_monitor.storage.db import DatabaseError


def _conn(host: str) -> Any:
    return cast(Any, SimpleNamespace(info=SimpleNamespace(host=host)))


def test_pooler_endpoint_refused() -> None:
    with pytest.raises(DatabaseError):
        loader.ensure_direct(_conn("ep-cool-123-pooler.eu-central-1.aws.neon.tech"))


def test_direct_endpoint_accepted() -> None:
    loader.ensure_direct(_conn("ep-cool-123.eu-central-1.aws.neon.tech"))


def test_terminal_statuses_do_not_block_a_group() -> None:
    for s in (loader.LoadStatus.BLOCKED, loader.LoadStatus.HELD, loader.LoadStatus.ERROR):
        assert s not in loader.TERMINAL
    assert loader.LoadStatus.SKIPPED_OUT_OF_ORDER in loader.TERMINAL
