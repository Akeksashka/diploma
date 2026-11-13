# Dashboard v2 implementation progress (orchestrator log)

Order: A, B, C, D, E, J, K, L, N, F (phase 1). Gated tasks (V30-V36, V48, V61, Group I) not started.
Node: ~/.nvm/versions/node/v26.13.1/bin (not on PATH). Only v26 is installed; .nvmrc says 20.18.1 (re-run on 20 before sign-off).

| Group | State |
|---|---|
| A (V1-V7) | implemented, Opus review: pass with fixes (6 fixes applied in the B run) |
| B (V8, V9, V64-min) | done, Opus review: pass with fixes (finding 2 fixed in C run). User to ratify: picker Go-button deviation from A1.2 (WCAG 3.2.2), mode-switch scope, src/country.md |
| C (V11, V12-V16; V11b conditional on V27) | V11-V16 implemented 2026-11-13, awaiting Opus review (gate C). Open for the user: three older browser smoke tests assume an active rebase control and contradict A1.5 (browser.smoke, series.smoke, ux.smoke; not edited, see docs/ops/dashboard-v2-decisions.md, Group C). V11b not built. |
| D (V17-V23) | implemented 2026-11-13, awaiting Opus review (gate D). Unit tests green (828 pass, 1 env failure: heatmap test reads src/data/scorecard/global.json). NOT run: npm run build, smoke (build into src/data was forbidden); new Plot behaviour (3-colour diverging range, blank-cell pattern, Plot default height of a band y scale) is unverified in a browser; no D smoke files written. See docs/ops/dashboard-v2-decisions.md is NOT updated (not in scope of this run); contradictions are in the agent report. |
