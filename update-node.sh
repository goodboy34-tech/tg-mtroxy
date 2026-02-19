#!/usr/bin/env bash
set -euo pipefail

echo "=== MTProxy Node Agent — обновление ==="

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [ -d .git ]; then
  git pull --rebase 2>/dev/null || true
fi

./scripts/manage-node.sh restart
echo "Node Agent обновлён и перезапущен."

