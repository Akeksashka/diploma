"""AC-DEP-1 (ADR-016): confine pandas, pandera and statsmodels to approved packages."""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

SRC_ROOT = Path(__file__).resolve().parents[2] / "src" / "macro_monitor"

# The single place listing where each restricted third-party package may be imported.
# Values are sub-packages of macro_monitor (directories); anything else, including
# top-level modules such as cli.py, is forbidden.
ALLOWED_PACKAGES: dict[str, frozenset[str]] = {
    "pandas": frozenset({"analytics", "validation"}),
    "pandera": frozenset({"analytics", "validation"}),
    "statsmodels": frozenset({"analytics"}),
}


def _imported_roots(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    roots: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            roots.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            roots.add(node.module.split(".")[0])
    return roots


def find_violations(root: Path) -> list[str]:
    violations: list[str] = []
    for path in sorted(root.rglob("*.py")):
        rel = path.relative_to(root)
        package = rel.parts[0] if len(rel.parts) > 1 else None
        for name in sorted(_imported_roots(path) & ALLOWED_PACKAGES.keys()):
            if package not in ALLOWED_PACKAGES[name]:
                violations.append(f"{rel.as_posix()}: imports {name}")
    return violations


def test_source_tree_respects_import_boundary() -> None:
    assert SRC_ROOT.is_dir()
    assert find_violations(SRC_ROOT) == []


def test_synthetic_violations_are_detected(tmp_path: Path) -> None:
    root = tmp_path / "macro_monitor"
    for sub in ("analytics", "validation", "ingestion", "storage"):
        (root / sub).mkdir(parents=True)
    (root / "analytics" / "ok.py").write_text("import pandas\nimport statsmodels.api\n")
    (root / "validation" / "ok.py").write_text("from pandera import Column\nimport pandas as pd\n")
    (root / "ingestion" / "bad.py").write_text("import pandas as pd\n")
    (root / "storage" / "bad.py").write_text("from pandera.typing import Series\n")
    (root / "validation" / "bad_stats.py").write_text("import statsmodels\n")
    (root / "cli.py").write_text("from pandas import DataFrame\n")

    assert find_violations(root) == [
        "cli.py: imports pandas",
        "ingestion/bad.py: imports pandas",
        "storage/bad.py: imports pandera",
        "validation/bad_stats.py: imports statsmodels",
    ]


def test_allowed_packages_are_known_subpackages() -> None:
    existing = {p.name for p in SRC_ROOT.iterdir() if p.is_dir() and not p.name.startswith("_")}
    for packages in ALLOWED_PACKAGES.values():
        assert packages <= existing


@pytest.mark.parametrize("name", ["pandas", "pandera", "statsmodels"])
def test_restricted_names_are_configured(name: str) -> None:
    assert name in ALLOWED_PACKAGES
