#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"

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
    # control-panel health = bot process + API port open; для API ключа отдельной проверки не делаем
    dc ps
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|logs|status|health}"
    exit 1
    ;;
esac
