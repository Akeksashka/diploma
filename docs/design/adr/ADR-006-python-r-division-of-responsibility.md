---
status: approved   # proposed | approved | superseded
---
# ADR-006: Python owns the data pipeline and scoring; R is a read-mostly analysis layer behind a database contract

## Context
- The user agreed on R/Python. CLAUDE.md fixes Python 3.12, type hints, ruff and pytest, and a Python `src/macro_monitor/` layout; the tooling research flagged R as a departure that needs an ADR or a CLAUDE.md update (finding 25). The user's stated position is "no preference between R and Python for analysis; CLAUDE.md's Python 3.12 convention stands unless design finds a reason to change it".
- What the approved goals actually require: U1 scorecards (percentile ranks, coverage n/N, staleness), U2 alerts (rolling z-score, robust z, fixed overrides), U3 long-run growth analysis. The first two are deterministic arithmetic on stored series and sit on the critical path of every monthly run.
- R strengths from the research: fpp3/forecast/tsibble, `seasonal` with X-13 (x13binary ships Windows/macOS binaries; Linux build needs a Fortran compiler [CRAN, UNVERIFIED for CI]), Quarto. R client packages are partly stale (OECD 2021, fredr 2021, readsdmx 2023). Python has statsmodels `DynamicFactorMQ` for mixed-frequency nowcasting and X-13 via an external binary (tooling research I, findings 10-11, 23).
- Source-published SA series exist for most indicators; the catalog rule is "use source-SA series; where only NSA is available use YoY; never MoM on NSA" (indicator selection, refresh handling), so own seasonal adjustment may be needed rarely or never.

## Options considered
1. Python only.
2. Python for ingestion/storage/validation/scoring; R for analysis modules (long-run growth, forecasts, seasonal adjustment, Quarto reports), exchanging data only through Neon views and tables.
3. R for analysis including scoring; Python for ingestion only.
4. Bridge packages (reticulate/rpy2) to call across languages. Adds version coupling (tooling research, mixed-language pitfalls).

## Decision
Option 2, with a hard boundary.
- Python (3.12): everything that writes `ingest`, `staging`, `curated`, `ops`; all of scoring and alerting (`analytics/`: transforms, staleness, z-scores, percentile ranks, coverage, snapshot) so that the monthly critical path has a single language and is covered by `pytest`.
- R (>= 4.1, as required by fpp3 per CRAN page, accessed 2026-10-17): optional modules for U3 and exploration: long-run growth and convergence analysis, forecasting/nowcast experiments, seasonal adjustment of NSA-only series, Quarto report sources. R runs as a separate job (`r-analysis`) after `load`, with `continue-on-error`, so an R failure never blocks data ingestion or alerts.
- Boundary contract: R connects with its own database role `mm_r` that can SELECT from `curated.*` views and `analytics.*` and can write only to schema `analytics_r`. R never fetches from sources and never writes to `curated`. Python never reads `analytics_r` except to export. Exchange types: periods as `date` (start) + frequency code; `numeric` read as double; every R output row carries `analysis_run_id`, `method`, `package_versions`, and (where derived from a series) `series_id` and the `known_at` cut-off used, so the metadata convention (source, series id, frequency, unit, SA, vintage) survives. Details: `docs/specs/analytics-and-r-contract-spec.md`.
- R toolchain: `renv.lock` at `src/macro_monitor/r/`, CI via `r-lib/actions` (`setup-r`, `setup-renv`) [DOC per research; runner and cache behaviour [UNVERIFIED]], tests with `testthat`, lint with `lintr` [UNVERIFIED tool choice]. GPL-3 R packages are used in place, not redistributed.
- R is enabled by repository variable `ENABLE_R=true`; until the first R module is specified and approved, the job is skipped. The first release of the pipeline does not need R.

## Consequences
- CLAUDE.md must be updated by the user before implementation (design cannot edit it): allow R for analysis under `src/macro_monitor/r/`, list tests under `tests/r/`, add R tooling, and add `.github/workflows/` and `manual_inbox/` to the paths the implementation agent may write (the current phase table allows only `src/`, `tests/`, `config/`, `scripts/`).
- Two lockfiles and two test runners; CI time rises only when `r/` changes or on the monthly run.
- If R packages turn out not to work in CI (x13binary build, wasm not needed), the fallback is Python statsmodels STL / the X-13 binary; no schema change.
- Scoring in Python means R can verify but not redefine the official ranks; any R-derived rank is stored in `analytics_r` with a different method label and is not shown in scorecards without a new decision.
