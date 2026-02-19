#!/usr/bin/env bash
set -euo pipefail

# #region agent log
LOG_FILE=".cursor/debug.log"
mkdir -p "$(dirname "$LOG_FILE")"
echo "{\"id\":\"manage_script_start\",\"timestamp\":$(date +%s000),\"location\":\"manage-control.sh:6\",\"message\":\"Manage script started\",\"data\":{\"pwd\":\"$(pwd)\",\"script_dir\":\"$(dirname "${BASH_SOURCE[0]}")\"},\"runId\":\"manage_run\",\"hypothesisId\":\"A\"}" >> "$LOG_FILE"
# #endregion

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"
CADDYFILE="${ROOT_DIR}/Caddyfile"

# #region agent log
echo "{\"id\":\"manage_root_determined\",\"timestamp\":$(date +%s000),\"location\":\"manage-control.sh:12\",\"message\":\"Root directory determined\",\"data\":{\"root_dir\":\"$ROOT_DIR\",\"compose_exists\":\"$([ -f "$COMPOSE_FILE" ] && echo true || echo false)\",\"caddyfile_exists\":\"$([ -f "$CADDYFILE" ] && echo true || echo false)\",\"env_exists\":\"$([ -f "${ROOT_DIR}/.env" ] && echo true || echo false)\"},\"runId\":\"manage_run\",\"hypothesisId\":\"A\"}" >> "$LOG_FILE"
# #endregion

cmd="${1:-help}"

dc() {
  # #region agent log
  echo "{\"id\":\"manage_docker_compose\",\"timestamp\":$(date +%s000),\"location\":\"manage-control.sh:14\",\"message\":\"Docker compose command\",\"data\":{\"compose_file\":\"$COMPOSE_FILE\",\"args\":\"$*\",\"env_file\":\"${ROOT_DIR}/.env\"},\"runId\":\"manage_run\",\"hypothesisId\":\"C\"}" >> "$LOG_FILE"
  # #endregion
  
  docker compose -f "${COMPOSE_FILE}" "$@"
}

case "${cmd}" in
  up|start)
    # #region agent log
    echo "{\"id\":\"manage_start_command\",\"timestamp\":$(date +%s000),\"location\":\"manage-control.sh:18\",\"message\":\"Start command called\",\"data\":{\"compose_file\":\"$COMPOSE_FILE\"},\"runId\":\"manage_run\",\"hypothesisId\":\"C\"}" >> "$LOG_FILE"
    # #endregion
    
    dc up -d --build
    
    # #region agent log
    echo "{\"id\":\"manage_start_completed\",\"timestamp\":$(date +%s000),\"location\":\"manage-control.sh:22\",\"message\":\"Start command completed\",\"data\":{\"exit_code\":\"$?\"},\"runId\":\"manage_run\",\"hypothesisId\":\"C\"}" >> "$LOG_FILE"
    # #endregion
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
  caddy-domain)
    # Изменить домен в Caddyfile и перевыпустить сертификат
    if [ -z "${2:-}" ]; then
      echo "Использование: $0 caddy-domain <новый-домен>"
      echo "Пример: $0 caddy-domain example.com"
      exit 1
    fi
    NEW_DOMAIN="$2"
    if [ ! -f "$CADDYFILE" ]; then
      echo "Ошибка: Caddyfile не найден"
      exit 1
    fi
    # Обновляем домен в Caddyfile (заменяем первую строку с доменом)
    sed -i "s|^[a-zA-Z0-9.-]* {|$NEW_DOMAIN {|" "$CADDYFILE"
    sed -i "s|^example.com|$NEW_DOMAIN|" "$CADDYFILE"
    # Обновляем домен в .env
    if [ -f "${ROOT_DIR}/.env" ]; then
      sed -i "s|^DOMAIN=.*|DOMAIN=$NEW_DOMAIN|" "${ROOT_DIR}/.env"
    fi
    echo "Домен обновлен на: $NEW_DOMAIN"
    echo "Перезапускаем Caddy для применения изменений..."
    dc restart caddy
    echo "Caddy перезапущен. Сертификат будет автоматически получен/обновлен."
    ;;
  caddy-reload)
    # Перезагрузить конфигурацию Caddy без перезапуска
    if docker ps | grep -q mtproxy-caddy; then
      docker exec mtproxy-caddy caddy reload --config /etc/caddy/Caddyfile
      echo "Конфигурация Caddy перезагружена"
    else
      echo "Ошибка: контейнер mtproxy-caddy не запущен"
      exit 1
    fi
    ;;
  caddy-cert)
    # Принудительно обновить SSL сертификат
    if docker ps | grep -q mtproxy-caddy; then
      docker exec mtproxy-caddy caddy reload --config /etc/caddy/Caddyfile
      echo "Обновление сертификата запущено. Проверьте логи: docker logs mtproxy-caddy"
    else
      echo "Ошибка: контейнер mtproxy-caddy не запущен"
      exit 1
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|logs|status|health|caddy-domain|caddy-reload|caddy-cert}"
    echo ""
    echo "Команды управления Caddy:"
    echo "  caddy-domain <домен>  - изменить домен и перевыпустить сертификат"
    echo "  caddy-reload          - перезагрузить конфигурацию Caddy"
    echo "  caddy-cert            - принудительно обновить SSL сертификат"
    exit 1
    ;;
esac
