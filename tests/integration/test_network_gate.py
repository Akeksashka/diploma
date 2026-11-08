"""Gate check: skipped by default; runs only with -m network and MM_ALLOW_NETWORK=1."""

from __future__ import annotations

import pytest


@pytest.mark.network
def test_network_gate_open() -> None:
    # Makes no request; it only proves the gate lets network-marked tests run when allowed.
    assert True
