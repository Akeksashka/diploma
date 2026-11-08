# Macro Monitor

Analysis and monitoring of macroeconomic data from open sources (World Bank, IMF, Eurostat, central banks, other public APIs/web sources).

## Workflow: four phases, strictly gated

| Phase | Command | Agent | Output (the only place it may write) |
|---|---|---|---|
| 1a. Scope: what to analyze | `/select-data <goal>` | `macro-economist` | `docs/research/` (indicator selection) |
| 1b. Research: where to get it | `/research <topic>` | `researcher` | `docs/research/` |
| 2. Design | `/design <topic>` | `macro-data-architect` | `docs/design/`, `docs/design/adr/`, `docs/specs/` |
| 3. Planning | `/plan <topic>` | `planner` | `docs/plans/` |
| 4. Implementation | `/implement <plan-file>` | `data-engineer` | `src/`, `tests/`, `config/`, `scripts/`, `.github/workflows/`, `.github/dependabot.yml`, `manual_inbox/`, `ops/`, `site/`, `docs/ops/`, and the root tooling files `pyproject.toml`, lockfile, `.python-version`, `.env.example`, `.gitignore` |

Rules:
- Do not start a phase until the previous phase's document has `status: approved` in its front matter. The user approves; agents never self-approve.
- 1b reads the approved indicator selection from 1a and assesses sources only for those indicators. The user, not an agent, sets the goal and approves the indicator list.
- Each phase reads the previous phase's documents as its source of truth. If they are wrong or incomplete, stop and report; do not silently work around them.
- Implementation never changes design decisions. A needed change = new/updated ADR in `docs/design/adr/`, approved first.
- Documents use the templates in `docs/_templates/`.
- Agents never approve documents, and never edit `CLAUDE.md` or `.claude/settings*.json` unless the user explicitly asks for that edit.
- Agents never dispatch workflows or push without an explicit user request in the current session.
- Model split when orchestrating subagents: implementation (phase 4, `data-engineer`) runs on Sonnet (`model: sonnet`); review runs on Opus (`model: opus`). A review is a separate, read-only subagent that checks the change against the approved ADRs, specs and plan, and is run before a task is reported as done. The orchestrator also re-runs ruff, mypy and the unit tests itself rather than trusting a subagent's report. Phases 1-3 are not covered by this rule.
- Cloud setup (Neon projects/branches, GitHub Actions secrets and repo settings) is allowed only when the user explicitly asks for that specific step. Use the Neon branch the user configures in the environment (NEON in .env, passed to tests as MM_TEST_DATABASE_URL) for experiments and db tests, whichever branch it is. That branch's default database neondb is also the production database (ADR-008): macro-monitor migrate may be applied to neondb only when the user explicitly asks for that step; never apply migrations to postgres. Tests on that branch may only create and drop their own throwaway databases and roles, never touching neondb; never modify or delete existing data in neondb outside the pipeline and forward-only migrations.. Read credentials only from environment variables or an authenticated gh/Neon session.
- Never ask for secrets in chat, never write them to files, and report what was changed

## Repository map
- `docs/research|design|plans|specs/` — phase artifacts (see above); `docs/ops/` — operator runbooks (e.g. `monthly-check.md`)
- `config/` — `sources.yaml` (registry of data sources, one entry per source/series group), `indicators.yaml`, `indicator_defaults.yaml` (shared indicator parameter defaults, ADR-014), `entities.yaml`, `release_calendar.yaml`, `series_map/`, `targets/`
- `src/macro_monitor/` — `cli.py`, `settings.py`, `registry/`, `ingestion/`, `validation/`, `storage/` (incl. forward-only SQL `migrations/`), `models/`, `analytics/`, `monitoring/`, `publish/` (dashboard export), `r/` (optional R modules)
- `.github/workflows/` — CI and pipeline workflows (orchestration: ADR-001); `scripts/ci/` — thin shell wrappers used by them; `.github/dependabot.yml` — dependency update config
- `manual_inbox/<source_id>/<YYYY-MM>/` — human-downloaded files with `.meta.yaml` sidecars (ADR-005)
- `ops/` — operational state committed by Actions (e.g. `heartbeat.json`)
- `site/` — static dashboard front-end source (ADR-010); no data files committed
- `data/` — local development mirror only: `raw/` (immutable, as fetched) → `staging/` (typed, normalized) → `curated/` (validated, analysis-ready). Git-ignored. Production storage is Postgres (Neon) plus the GitHub raw archive (ADR-002, ADR-003, ADR-008).
- `tests/` — `unit/` (no network, no DB), `integration/` (`db` and `network` markers), `fixtures/` (recorded bytes, golden outputs), `r/` (testthat)

## Global engineering conventions
- Python 3.12, type hints required. Tooling: `uv` for dependency locking (`pyproject.toml` + lockfile; fallback `pip-tools` if uv fails the first CI run), `ruff check` and `ruff format`, `mypy --strict src`, `pytest`, `actionlint` for workflow YAML.
- pytest markers: unit tests have no network and no DB; `@pytest.mark.db` needs a Postgres service/container; `@pytest.mark.db_invariants`; `@pytest.mark.network` for live probes — never run on PRs, run only when the user asks.
- Language split (ADR-006): Python for ingestion, validation, storage, monitoring and the core analytics; R only for optional analysis modules, off by default, reading Postgres views (`renv`, `testthat`, `lintr`). Node.js is a build-time tool for `site/` only, on the Actions runner.
- Workflow YAML: actions pinned by commit SHA, minimal `permissions`, user-controlled values only through `env:` (never interpolated into `run:`), `actionlint` clean.
- Schema changes are new forward-only migrations; never edit an applied migration. Never UPDATE or DELETE curated, raw-manifest or history tables.
- Raw data is immutable and stored with source URL, fetch timestamp, and content hash.
- Every series carries: source, series id, frequency, unit, seasonal adjustment, vintage/release date.
- Preserve vintages (revisions); never overwrite published values in place.
- No secrets in the repo. API keys via env vars; see `.env.example`. Never write passwords from `.env`.
- Respect source terms, rate limits, and robots.txt. Cache and use conditional requests.
- Cite sources (URL + access date) for every factual claim in research and design docs. Mark unverified claims as such.
