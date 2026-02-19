#!/usr/bin/env bash
set -euo pipefail

echo "=== Install control-panel (docker compose) ==="

if ! command -v docker &>/dev/null; then
  echo "Docker not found. Install docker first."
  exit 1
fi

if ! docker compose version &>/dev/null; then
  echo "docker compose not found. Install docker compose plugin."
  exit 1
fi

if [ ! -f .env ]; then
  echo "Creating .env from ENV.example"
  cp ENV.example .env
  echo "Edit .env and rerun."
  exit 0
fi

chmod +x scripts/manage-control.sh || true
./scripts/manage-control.sh start

echo "OK. Use: ./scripts/manage-control.sh logs"
