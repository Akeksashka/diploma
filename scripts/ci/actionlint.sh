#!/usr/bin/env bash
# Lint workflow YAML with a pinned, checksum-verified actionlint (linux amd64 runner).
# Set MM_ACTIONLINT_BIN to use an existing binary instead (local runs).
set -euo pipefail
cd "$(dirname "$0")/../.."

VERSION="1.7.12"
SHA256="8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"
ARCHIVE="actionlint_${VERSION}_linux_amd64.tar.gz"
URL="https://github.com/rhysd/actionlint/releases/download/v${VERSION}/${ARCHIVE}"

if [ -n "${MM_ACTIONLINT_BIN:-}" ]; then
  bin="$MM_ACTIONLINT_BIN"
else
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL --retry 3 -o "$tmp/$ARCHIVE" "$URL"
  echo "${SHA256}  $tmp/$ARCHIVE" | sha256sum --check --strict -
  tar -xzf "$tmp/$ARCHIVE" -C "$tmp" actionlint
  bin="$tmp/actionlint"
fi

"$bin" -color
