"""T59 manual connector: sidecar contract (rule 18), path allow-list, import-time stamp."""

from __future__ import annotations

from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

import pytest

from macro_monitor import cli
from macro_monitor.ingestion.base import GroupConfig
from macro_monitor.ingestion.connectors.manual import (
    ManualConnector,
    ManualInboxError,
    list_inbox_files,
    read_sidecar,
    resolve_inbox_file,
    validate_sidecar,
)
from macro_monitor.settings import InputError, parse_inbox_path

GOOD: dict[str, Any] = {
    "source_url": "https://example.org/x",
    "downloaded_on": "2026-10-20",
    "downloaded_by": "op",
    "edition_label": "WEO-2026-10",
    "edition_date": "2026-10-14",
}


def test_valid_sidecar_carries_edition_date() -> None:
    s = validate_sidecar(GOOD, edition_ordered=True)
    assert s.edition_date == date(2026, 10, 14)
    assert s.import_label is None


def test_missing_edition_date_rejected_for_edition_ordered() -> None:
    bad = {k: v for k, v in GOOD.items() if k != "edition_date"}
    with pytest.raises(ManualInboxError, match="edition_date"):
        validate_sidecar(bad, edition_ordered=True)
    assert validate_sidecar(bad, edition_ordered=False).edition_date is None


@pytest.mark.parametrize("label", ["other", "", "ARCHIVE_IMPORT"])
def test_import_label_only_archive_import(label: str) -> None:
    with pytest.raises(ManualInboxError, match="import_label"):
        validate_sidecar({**GOOD, "import_label": label}, edition_ordered=True)
    ok = validate_sidecar({**GOOD, "import_label": "archive_import"}, edition_ordered=True)
    assert ok.import_label == "archive_import"


def test_unknown_key_and_bad_date_rejected() -> None:
    with pytest.raises(ManualInboxError):
        validate_sidecar({**GOOD, "extra": 1})
    with pytest.raises(ManualInboxError):
        validate_sidecar({**GOOD, "edition_date": "14/10/2026"})
    with pytest.raises(ManualInboxError):
        validate_sidecar(["x"])


def _inbox(tmp_path: Path) -> Path:
    d = tmp_path / "manual_inbox" / "imf_weo_manual" / "2026-10"
    d.mkdir(parents=True)
    (d / "weo.csv").write_bytes(b"a,b\n1,2\n")
    (d / "weo.csv.meta.yaml").write_text(
        "\n".join(f"{k}: {v}" for k, v in GOOD.items()), encoding="utf-8"
    )
    return tmp_path


def test_listing_excludes_sidecars_and_reads_sidecar(tmp_path: Path) -> None:
    root = _inbox(tmp_path)
    files = list_inbox_files(root, "imf_weo_manual")
    assert files == ["manual_inbox/imf_weo_manual/2026-10/weo.csv"]
    side = read_sidecar(resolve_inbox_file(root, "imf_weo_manual", files[0]), edition_ordered=True)
    assert side.edition_label == "WEO-2026-10"


@pytest.mark.parametrize(
    "rel",
    [
        "manual_inbox/imf_weo_manual/2026-10/../../../etc/passwd",
        "manual_inbox/other/2026-10/weo.csv",
        "manual_inbox/imf_weo_manual/2026-13/weo.csv",
        "manual_inbox/imf_weo_manual/2026-10/weo.csv.meta.yaml",
        "/manual_inbox/imf_weo_manual/2026-10/weo.csv",
        "manual_inbox/imf_weo_manual/2026-10/missing.csv",
        "manual_inbox/imf_weo_manual/2026-10/a b.csv",
    ],
)
def test_path_allow_list(tmp_path: Path, rel: str) -> None:
    with pytest.raises(ManualInboxError):
        resolve_inbox_file(_inbox(tmp_path), "imf_weo_manual", rel)


def test_symlink_refused(tmp_path: Path) -> None:
    root = _inbox(tmp_path)
    d = root / "manual_inbox/imf_weo_manual/2026-10"
    (d / "link.csv").symlink_to(root / "manual_inbox/imf_weo_manual/2026-10/weo.csv")
    with pytest.raises(ManualInboxError, match="symbolic"):
        resolve_inbox_file(root, "imf_weo_manual", "manual_inbox/imf_weo_manual/2026-10/link.csv")


def test_fetch_stamps_import_time_not_file_date(tmp_path: Path) -> None:
    root = _inbox(tmp_path)
    now = datetime(2026, 11, 3, 9, 0, tzinfo=UTC)
    conn = ManualConnector(root, clock=lambda: now)
    group = GroupConfig("imf_weo_manual", "imf_weo_files", "", {}, "complete")
    specs = conn.plan(group, None, "manual")  # type: ignore[arg-type]
    assert len(specs) == 1
    res = conn.fetch(specs[0], None, None)  # type: ignore[arg-type]
    assert res.fetched_at == now
    assert res.body == b"a,b\n1,2\n"
    assert res.outcome == "new"


def test_cli_ingest_manual_args_are_allow_listed() -> None:
    p = cli.build_parser()
    ns = p.parse_args(["ingest-manual", "--group", "imf_weo_files"])
    assert ns.group == "imf_weo_files"
    for bad in ("manual_inbox/../x", "x/y", "manual_inbox/a/2026-10/f;rm"):
        with pytest.raises(InputError):
            parse_inbox_path(bad)
    with pytest.raises(SystemExit) as e:
        p.parse_args(["ingest-manual", "--group", "A;b"])
    assert e.value.code == cli.EXIT_CONFIG_ERROR
