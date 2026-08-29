#!/bin/zsh
set -u

ROOT="${0:A:h}"
cd "$ROOT"
exec /usr/bin/python3 tools/serve-education-local.py
