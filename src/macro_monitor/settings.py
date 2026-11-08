"""Environment-variable names, settings loader and allow-list validation of CLI inputs.

Only names live here; values come from the process environment (never from files in the repo).
Workflow inputs reach the CLI through environment variables and are re-validated here against
allow-list patterns (workflows spec section 1; they are never evaluated in a shell).
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date

ENV_MM_ENV = "MM_ENV"
ENV_MM_RAW_STORE = "MM_RAW_STORE"
ENV_MM_ALLOW_NETWORK = "MM_ALLOW_NETWORK"
ENV_MM_TEST_DATABASE_URL = "MM_TEST_DATABASE_URL"
ENV_DATABASE_URL = "DATABASE_URL"
ENV_MM_MODE = "MM_MODE"
ENV_MM_GROUPS = "MM_GROUPS"
ENV_MM_RAW_ID = "MM_RAW_ID"

GROUPS_PATTERN = re.compile(r"^[a-z0-9_,]*$")
GROUP_ID_PATTERN = re.compile(r"^[a-z0-9_]+$")
RAW_ID_PATTERN = re.compile(r"^[0-9]{1,18}$")
DATE_PATTERN = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
GIT_SHA_PATTERN = re.compile(r"^[0-9a-f]{7,40}$")
MODES = ("refresh", "catchup", "manual", "preflight")
MAX_GROUPS_LENGTH = 2000

_TRIGGERS = {"schedule": "schedule", "workflow_dispatch": "dispatch", "push": "push"}


class InputError(ValueError):
    """A CLI input failed its allow-list (exit code 20)."""


def parse_groups(text: str) -> tuple[str, ...]:
    """Validate a comma-separated group list (``^[a-z0-9_,]*$``); empty items are dropped."""
    if len(text) > MAX_GROUPS_LENGTH:
        raise InputError(f"group list longer than {MAX_GROUPS_LENGTH} characters")
    if GROUPS_PATTERN.fullmatch(text) is None:
        raise InputError("group list must match ^[a-z0-9_,]*$")
    seen: dict[str, None] = {}
    for item in text.split(","):
        if item:
            seen.setdefault(item)
    return tuple(seen)


def parse_group_id(text: str) -> str:
    if GROUP_ID_PATTERN.fullmatch(text) is None:
        raise InputError("group id must match ^[a-z0-9_]+$")
    return text


INBOX_PATH_PATTERN = re.compile(
    r"manual_inbox/[a-z0-9_]+/[0-9]{4}-(0[1-9]|1[0-2])/[A-Za-z0-9][A-Za-z0-9._-]{0,127}"
)


def parse_inbox_path(text: str) -> str:
    if INBOX_PATH_PATTERN.fullmatch(text) is None:
        raise InputError("path must be manual_inbox/<source_id>/<YYYY-MM>/<file>")
    return text


def parse_raw_id(text: str) -> int:
    if RAW_ID_PATTERN.fullmatch(text) is None:
        raise InputError("raw id must be a non-negative integer")
    return int(text)


def parse_iso_date(text: str) -> date:
    if DATE_PATTERN.fullmatch(text) is None:
        raise InputError("date must be YYYY-MM-DD")
    try:
        return date.fromisoformat(text)
    except ValueError as exc:
        raise InputError("date must be a valid calendar date") from exc


def parse_mode(text: str) -> str:
    if text not in MODES:
        raise InputError(f"mode must be one of {', '.join(MODES)}")
    return text


def _int_or_none(text: str | None) -> int | None:
    if text is None or RAW_ID_PATTERN.fullmatch(text) is None:
        return None
    return int(text)


@dataclass(frozen=True)
class Settings:
    """Process-level settings read from the environment."""

    env: str
    raw_store: str | None
    database_url: str | None = field(default=None, repr=False)  # a secret: never printed
    git_sha: str = "unknown"
    trigger: str = "local"
    gh_run_id: int | None = None
    gh_run_attempt: int | None = None
    repo_url: str = "https://github.com/unknown/macro-monitor"

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> Settings:
        source = os.environ if environ is None else environ
        sha = source.get("GITHUB_SHA", "")
        repo = source.get("GITHUB_REPOSITORY", "")
        repo_ok = re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repo) is not None
        return cls(
            env=source.get(ENV_MM_ENV, "dev"),
            raw_store=source.get(ENV_MM_RAW_STORE),
            database_url=source.get(ENV_DATABASE_URL) or None,
            git_sha=sha if GIT_SHA_PATTERN.fullmatch(sha) else "unknown",
            trigger=_TRIGGERS.get(source.get("GITHUB_EVENT_NAME", ""), "local"),
            gh_run_id=_int_or_none(source.get("GITHUB_RUN_ID")),
            gh_run_attempt=_int_or_none(source.get("GITHUB_RUN_ATTEMPT")),
            repo_url=f"https://github.com/{repo}" if repo_ok else cls.repo_url,
        )
