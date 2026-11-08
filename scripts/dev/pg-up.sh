#!/usr/bin/env bash
# Start a local throwaway Postgres in Docker for `pytest -m db`.
# Version: MM_PG_VERSION (default 17, the working assumption of design BB31 / plan OP-11,
# UNVERIFIED against Neon). Port: MM_PG_PORT (default 54329).
set -euo pipefail

version="${MM_PG_VERSION:-17}"
port="${MM_PG_PORT:-54329}"
name="${MM_PG_CONTAINER:-macro-monitor-pg}"
password="${MM_PG_PASSWORD:-postgres}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found. Install Docker, or point MM_TEST_DATABASE_URL at any local" >&2
  echo "Postgres superuser DSN (see docs/ops/local-development.md)." >&2
  exit 1
fi

if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
  docker start "$name" >/dev/null
else
  docker run -d --name "$name" \
    -e POSTGRES_PASSWORD="$password" \
    -p "127.0.0.1:${port}:5432" \
    "postgres:${version}" >/dev/null
fi

for _ in $(seq 1 60); do
  if docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; then
    echo "Postgres ${version} ready. Run:"
    echo "  export MM_TEST_DATABASE_URL=postgresql://postgres:${password}@127.0.0.1:${port}/postgres"
    exit 0
  fi
  sleep 1
done
echo "Postgres did not become ready in 60 s" >&2
exit 1
