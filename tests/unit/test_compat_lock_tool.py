"""T04 spike BB17: the uv lockfile is present, current and Python 3.12 only."""

from __future__ import annotations

import tomllib
from pathlib import Path

_ROOT = Path(__file__).parent.parent.parent


def test_uv_lock_is_well_formed_and_pins_python_312() -> None:
    lock = tomllib.loads((_ROOT / "uv.lock").read_text(encoding="utf-8"))
    assert lock["requires-python"] == "==3.12.*"
    pinned = {p["name"]: p["version"] for p in lock["package"]}
    for name in ("pandas", "pandera", "pyarrow", "sdmx1", "jsonschema", "lxml"):
        assert name in pinned, name


def test_lock_covers_every_declared_dependency() -> None:
    lock = tomllib.loads((_ROOT / "uv.lock").read_text(encoding="utf-8"))
    project = next(p for p in lock["package"] if p["name"] == "macro-monitor")
    locked = {d["name"] for d in project["dependencies"]}
    declared = tomllib.loads((_ROOT / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    names = {
        d.split("[")[0].split(">")[0].split("=")[0].strip().lower()
        for d in declared["dependencies"]
    }
    normalized = {n.replace("pyyaml", "pyyaml") for n in names}
    assert normalized <= {n.lower() for n in locked}
