#!/usr/bin/env bash
# CI site smoke (T94): installs Chromium with the Playwright CLI (the only place a browser is
# downloaded, ADR-016/ADR-024), then runs the browser and static smoke tests against site/dist.
# Needs a built site (npm run build) and EXPORT_DIR (the fixture export it was built from).
# Runs every tests/smoke/*.smoke.mjs, including the T107 UX smoke (ux.smoke.mjs), which writes review screenshots to
# site/test-artifacts/ (git-ignored). TODO(OP-07, B5): upload that directory once a verified actions/upload-artifact SHA exists.
# Local runs without a download: MM_SMOKE_SKIP_INSTALL=1 plus MM_SMOKE_CHANNEL=chrome. No secrets.
set -euo pipefail
cd "$(dirname "$0")/../../site"

if [ "${MM_SMOKE_SKIP_INSTALL:-0}" != "1" ]; then
  npx --no-install playwright install --with-deps --only-shell chromium
fi
# A missing browser must fail CI instead of skipping the tests.
MM_SMOKE_REQUIRE_BROWSER=1 npm run smoke
