# G-DEPLOY: two-tree deploy workflow change (PROPOSAL, NOT APPLIED)

Status: proposed 2026-11-14. `.github/workflows/` and `scripts/ci/` are untouched. Applying this needs the user's scope approval (plan gate G-DEPLOY, V42 workflow part). No dispatch, no push.

## Facts checked in the repository
- The site is built only in `.github/workflows/ci.yml` (job with `npm run build`, then `uv run macro-monitor check-site --site-dir site/dist`) and wrapped for smoke by `scripts/ci/site-smoke.sh` (reads `site/dist`). No workflow publishes the site to Pages in this repository, so there is no deploy step to edit; the two-tree publish has nothing to attach to until one exists.
- Site side is ready: `npm run build:all` writes `site/dist` (English, `/`), `site/dist-uk` (`/uk/`) and the merged `site/dist-site` (decisions file, V42/V43).

## Proposed change (smallest)
1. Add one CI step after "Build" in the site job, so the Ukrainian tree and the merge are exercised on every run:

```yaml
      - name: Build Ukrainian tree and merge (V42)
        working-directory: site
        run: |
          npm run build:uk
          node scripts/merge-trees.mjs dist dist-uk dist-site
```

2. Keep `check-site --site-dir site/dist` on the English tree. Do not point it at `dist-uk` until it is checked that it tolerates base `/uk/` ([UNVERIFIED]).
3. When a Pages deploy job is added (separate decision), it builds with `npm run build:all` and uploads `site/dist-site`. Actions pinned by SHA as in `ci.yml`, minimal `permissions`, user-controlled values only through `env:`.
4. Run `scripts/ci/actionlint.sh` on the edited workflow before approval.

## Open for the user
- Approve the CI step (1) or leave CI English-only.
- Whether a Pages deploy job should be created at all (out of scope of V42 as written).
