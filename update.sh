#!/usr/bin/env bash
set -euo pipefail

echo "=== MTProxy Control Panel — обновление ==="

# #region agent log
LOG_FILE=".cursor/debug.log"
mkdir -p "$(dirname "$LOG_FILE")"
echo "{\"id\":\"update_script_start\",\"timestamp\":$(date +%s000),\"location\":\"update.sh:8\",\"message\":\"Update script started\",\"data\":{\"pwd\":\"$(pwd)\",\"script_dir\":\"$(dirname "${BASH_SOURCE[0]}")\"},\"runId\":\"update_run\",\"hypothesisId\":\"A\"}" >> "$LOG_FILE"
# #endregion

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# #region agent log
echo "{\"id\":\"update_root_determined\",\"timestamp\":$(date +%s000),\"location\":\"update.sh:12\",\"message\":\"Root directory determined\",\"data\":{\"root\":\"$ROOT\",\"git_exists\":\"$([ -d "$ROOT/.git" ] && echo true || echo false)\"},\"runId\":\"update_run\",\"hypothesisId\":\"A\"}" >> "$LOG_FILE"
# #endregion

cd "$ROOT"

if [ -d .git ]; then
  # #region agent log
  echo "{\"id\":\"update_git_pull_start\",\"timestamp\":$(date +%s000),\"location\":\"update.sh:18\",\"message\":\"Starting git pull\",\"data\":{},\"runId\":\"update_run\",\"hypothesisId\":\"B\"}" >> "$LOG_FILE"
  # #endregion
  
  git pull --rebase 2>/dev/null || true
  
  # #region agent log
  echo "{\"id\":\"update_git_pull_result\",\"timestamp\":$(date +%s000),\"location\":\"update.sh:22\",\"message\":\"Git pull completed\",\"data\":{\"exit_code\":\"$?\"},\"runId\":\"update_run\",\"hypothesisId\":\"B\"}" >> "$LOG_FILE"
  # #endregion
else
  # #region agent log
  echo "{\"id\":\"update_no_git\",\"timestamp\":$(date +%s000),\"location\":\"update.sh:26\",\"message\":\"No .git directory found\",\"data\":{\"root\":\"$ROOT\"},\"runId\":\"update_run\",\"hypothesisId\":\"B\"}" >> "$LOG_FILE"
  # #endregion
fi

# #region agent log
echo "{\"id\":\"update_restart_start\",\"timestamp\":$(date +%s000),\"location\":\"update.sh:30\",\"message\":\"Starting restart\",\"data\":{\"manage_script_exists\":\"$([ -f ./scripts/manage-control.sh ] && echo true || echo false)\"},\"runId\":\"update_run\",\"hypothesisId\":\"C\"}" >> "$LOG_FILE"
# #endregion

./scripts/manage-control.sh restart

# #region agent log
echo "{\"id\":\"update_complete\",\"timestamp\":$(date +%s000),\"location\":\"update.sh:34\",\"message\":\"Update script completed\",\"data\":{\"restart_exit_code\":\"$?\"},\"runId\":\"update_run\",\"hypothesisId\":\"C\"}" >> "$LOG_FILE"
# #endregion

echo "Control Panel обновлён и перезапущен."

