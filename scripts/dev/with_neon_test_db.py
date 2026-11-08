#!/usr/bin/env python3
"""Run a command with MM_TEST_DATABASE_URL taken from NEON in .env, never printing it.

Usage: python3 -I scripts/dev/with_neon_test_db.py -- .venv/bin/pytest -m db tests/integration/x.py

The pooled Neon host (`-pooler`, pgbouncer) rejects the startup parameters the db tests
send, so the direct endpoint is derived by dropping `-pooler`. The value is read here, passed
only to the child's environment, and any DSN or password in the child's output is masked.
Tests may only create and drop their own throwaway databases and roles (CLAUDE.md).
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

_LINE = re.compile(r"\s*NEON\s*=\s*(.*?)\s*$")
_DSN = re.compile(r"postgres(?:ql)?://\S*")
_PWD = re.compile(r"password=\S*")


def read_neon(env_file: Path) -> str | None:
    for line in env_file.read_text().splitlines():
        m = _LINE.match(line)
        if m:
            return m.group(1).strip("'\"")
    return None


def mask(text: str, secret: str | None) -> str:
    text = _PWD.sub("password=***", _DSN.sub("<dsn>", text))
    return text.replace(secret, "***") if secret else text


def main(argv: list[str]) -> int:
    if "--" not in argv or argv.index("--") == len(argv) - 1:
        print("usage: with_neon_test_db.py -- <command> [args...]", file=sys.stderr)
        return 2
    cmd = argv[argv.index("--") + 1 :]
    root = Path(__file__).resolve().parents[2]
    value = read_neon(root / ".env")
    if not value:
        print("NEON is not set in .env", file=sys.stderr)
        return 2
    env = dict(os.environ, MM_TEST_DATABASE_URL=value.replace("-pooler", ""))
    proc = subprocess.Popen(
        cmd, cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
    )
    assert proc.stdout is not None
    for line in proc.stdout:
        sys.stdout.write(mask(line, value))
        sys.stdout.flush()
    return proc.wait()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
