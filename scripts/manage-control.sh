#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"
CADDYFILE="${ROOT_DIR}/Caddyfile"

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
