#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.node.yml"

cmd="${1:-help}"

dc() {
  docker compose -f "${COMPOSE_FILE}" "$@"
}

case "${cmd}" in
  up|start)
    dc up -d --build
    ;;
  down|stop)
    dc down
    ;;
  restart)
    dc restart
    ;;
  logs)
    dc logs -f --tail 200
    ;;
  status)
    dc ps
    ;;
  health)
    # Node agent health endpoint:
    curl -fsS -H "Authorization: Bearer ${API_TOKEN:-}" "http://127.0.0.1:8080/health" || true
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|logs|status|health}"
    echo "Env: API_TOKEN must be exported for health check"
    exit 1
    ;;
esac
