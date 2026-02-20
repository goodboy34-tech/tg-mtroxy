#!/usr/bin/env bash
set -euo pipefail

echo "=== MTProxy Control Panel — обновление ==="

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

if [ -d .git ]; then
  git pull --rebase 2>/dev/null || true
fi

./scripts/manage-control.sh restart
echo "Control Panel обновлён и перезапущен."

