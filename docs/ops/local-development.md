# Local development

## Setup
- `uv sync`
- Checks: `uv run ruff check`, `uv run ruff format --check`, `uv run mypy --strict src`, `uv run pytest`.

## Postgres for `db` tests
`db` tests need a real Postgres and a superuser DSN in `MM_TEST_DATABASE_URL`. Without it they
are skipped with a message naming the variable.

Option A, Docker:
```
scripts/dev/pg-up.sh          # starts postgres:${MM_PG_VERSION:-17} on 127.0.0.1:54329
export MM_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres
uv run pytest -m db
scripts/dev/pg-down.sh
```
Option B, any local Postgres: set `MM_TEST_DATABASE_URL` to a superuser DSN (role with
CREATEDB and CREATEROLE, plus the right to `DROP DATABASE ... WITH (FORCE)`, so PostgreSQL 13+).

Version: PostgreSQL 17 is a working assumption (design BB31, plan OP-11/OQ-08), UNVERIFIED
against Neon until the Neon project exists. Override with `MM_PG_VERSION` and align CI
(T03) once the user states Neon's major version.

## What the fixtures do (`tests/conftest.py`)
- `test_database`: per test, creates database `mm_test_<tag>` and one login role per DDL role
  (`mm_owner`, `mm_ingest`, `mm_analytics`, `mm_r`, `mm_reader`) named `<role>_<tag>`, because
  roles are cluster-global. The database is owned by the `mm_owner` copy. Everything is dropped
  afterwards. Use `test_database.dsn("mm_ingest")` or `.connect("mm_reader")`.
- `two_sessions(dsn, timeout=10)`: two independent connections with `statement_timeout` and
  `lock_timeout`, for concurrency tests (a blocked statement raises instead of hanging).
- Point `MM_TEST_DATABASE_URL` only at a throwaway local Postgres or at the Neon test branch the user configured (`NEON` in `.env`). On Neon, tests may only create and drop their own throwaway databases and roles; never modify existing data and never migrate `neondb` or `postgres` (CLAUDE.md). Use the direct endpoint, not the `-pooler` host. `python3 -I scripts/dev/with_neon_test_db.py -- .venv/bin/pytest -m db <files>` reads `NEON` itself and masks the DSN in output. Neon is slow: expect minutes per db test file.

## Slice end-to-end test (M1 exit, T31)
`tests/integration/test_slice_e2e.py` (`db` marker) runs migrate, sync-config, fetch (mock
transport, recorded fixtures `tests/fixtures/raw/eurostat/une_rt_m_synthetic.json` and
`..._r2.json`), and `load --drain` from an empty database, then repeats the second release.
```
MM_TEST_DATABASE_URL=... uv run pytest tests/integration/test_slice_e2e.py
```
It checks first-sight series creation, one new revision row for the one revised key, as-of
before/after, stored validation results, and zero new `raw_object` / observations on the repeat.
