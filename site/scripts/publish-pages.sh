#!/usr/bin/env bash
# Builds both language trees under a GitHub project-pages prefix and force-pushes dist-site to the gh-pages branch.
# Usage: scripts/publish-pages.sh [--dry-run]   (env: EXPORT_DIR default ../data/export, PAGES_PREFIX default /diploma, PAGES_REMOTE default origin)
set -euo pipefail
cd "$(dirname "$0")/.."
export EXPORT_DIR="${EXPORT_DIR:-../data/export}"
export MM_BASE_PREFIX="${PAGES_PREFIX:-/diploma}"
remote="${PAGES_REMOTE:-origin}"
[ -f "$EXPORT_DIR/manifest.json" ] || { echo "publish-pages: no manifest.json in $EXPORT_DIR; run the export first" >&2; exit 1; }
npm run build:all
touch dist-site/.nojekyll
if [ "${1:-}" = "--dry-run" ]; then echo "publish-pages: dry run, built dist-site with prefix $MM_BASE_PREFIX"; exit 0; fi
url="$(git remote get-url "$remote")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp -R dist-site/. "$tmp/"
git -C "$tmp" init -q -b gh-pages
git -C "$tmp" add -A
git -C "$tmp" commit -q -m "Publish site $(date -u +%Y-%m-%dT%H:%MZ)"
git -C "$tmp" push -q --force "$url" gh-pages
echo "publish-pages: pushed to $remote gh-pages"
