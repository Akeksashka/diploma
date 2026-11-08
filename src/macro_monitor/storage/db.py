"""Database connection helper and exit codes (ingestion spec: 30 database, 40 migration)."""

from __future__ import annotations

import psycopg
from psycopg.conninfo import conninfo_to_dict

EXIT_DATABASE_ERROR = 30
EXIT_MIGRATION_MISMATCH = 40

DEFAULT_CONNECT_TIMEOUT_S = 10


class DatabaseError(Exception):
    """A database-level refusal or failure that maps to the database exit code."""

    exit_code = EXIT_DATABASE_ERROR


def is_pooled_dsn(dsn: str) -> bool:
    """True when the host looks like a Neon pooler endpoint (``-pooler`` in the host name).

    Session-level advisory locks are not reliable through a transaction pooler (BB20).
    """
    host = conninfo_to_dict(dsn).get("host") or ""
    return "-pooler" in str(host)


def connect(dsn: str, *, connect_timeout: int = DEFAULT_CONNECT_TIMEOUT_S) -> psycopg.Connection:
    """Open a plain (non-autocommit) connection. The caller owns commit and close."""
    return psycopg.connect(dsn, connect_timeout=connect_timeout)
