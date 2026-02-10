#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(dirname "$SCRIPT_DIR")"
cd "$WORK_DIR"

# Загружаем переменные из .env
if [ -f .env ]; then
  source .env
else
  echo "❌ Файл .env не найден!"
  exit 1
fi

show_help() {
  echo "════════════════════════════════════════════════════"
  echo "  MTProxy Local Proxy Management"
  echo "════════════════════════════════════════════════════"
  echo ""
  echo "Управление локальным прокси на сервере Control Panel"
  echo ""
  echo "Использование: $0 <command>"
  echo ""
  echo "Команды:"
  echo "  start          Запустить локальный прокси"
  echo "  stop           Остановить локальный прокси"
  echo "  restart        Перезапустить локальный прокси"
  echo "  status         Статус локального прокси"
  echo "  links          Показать ссылки для подключения"
  echo "  logs           Показать логи"
  echo "  generate       Сгенерировать новый секрет"
  echo ""
}

start_local_proxy() {
  echo "🚀 Запуск локального прокси..."
  docker-compose --profile local-proxy up -d local-mtproxy local-socks5
  echo "✅ Локальный прокси запущен"
  sleep 2
  show_links
}

stop_local_proxy() {
  echo "⏹️  Остановка локального прокси..."
  docker-compose stop local-mtproxy local-socks5
  echo "✅ Локальный прокси остановлен"
}

restart_local_proxy() {
  echo "🔄 Перезапуск локального прокси..."
  docker-compose restart local-mtproxy local-socks5
  echo "✅ Локальный прокси перезапущен"
  sleep 2
  show_links
}

show_status() {
  echo "📊 Статус локального прокси:"
  echo ""
  docker-compose ps local-mtproxy local-socks5
  echo ""
  
  # Проверяем запущены ли контейнеры
  MTPROTO_RUNNING=$(docker inspect -f '{{.State.Running}}' mtproxy-local 2>/dev/null || echo "false")
  SOCKS5_RUNNING=$(docker inspect -f '{{.State.Running}}' mtproxy-local-socks5 2>/dev/null || echo "false")
  
  if [ "$MTPROTO_RUNNING" = "true" ]; then
    echo "✅ MTProto: запущен"
    
    # Получаем статистику
    STATS=$(docker exec mtproxy-local curl -s http://localhost:2398/stats 2>/dev/null || echo "")
    if [ -n "$STATS" ]; then
      CONNECTIONS=$(echo "$STATS" | grep "total_special_connections" | awk '{print $2}')
      MAX_CONNECTIONS=$(echo "$STATS" | grep "total_max_special_connections" | awk '{print $2}')
      echo "   Подключений: $CONNECTIONS / $MAX_CONNECTIONS"
    fi
  else
    echo "❌ MTProto: не запущен"
  fi
  
  if [ "$SOCKS5_RUNNING" = "true" ]; then
    echo "✅ SOCKS5: запущен"
  else
    echo "❌ SOCKS5: не запущен"
  fi
}

show_links() {
  echo "🔗 Ссылки для подключения к локальному прокси:"
  echo ""
  
  # Получаем IP сервера
  SERVER_IP=$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')
  
  # Получаем секрет из логов контейнера
  SECRET=$(docker logs mtproxy-local 2>&1 | grep -oP 'Secret.*: \K[a-f0-9]{32}' | head -1)
  
  if [ -z "$SECRET" ]; then
    echo "⚠️  Секрет не найден. Возможно контейнер еще запускается..."
    echo "   Попробуйте через несколько секунд: $0 links"
    return
  fi
  
  LOCAL_MTPROTO_PORT=${LOCAL_MTPROTO_PORT:-8443}
  LOCAL_SOCKS5_PORT=${LOCAL_SOCKS5_PORT:-1081}
  
  echo "═══ MTProto Proxy ═══"
  echo ""
  echo "Fake-TLS (рекомендуется):"
  echo "  tg://proxy?server=$SERVER_IP&port=$LOCAL_MTPROTO_PORT&secret=dd$SECRET"
  echo ""
  echo "Обычный:"
  echo "  tg://proxy?server=$SERVER_IP&port=$LOCAL_MTPROTO_PORT&secret=$SECRET"
  echo ""
  echo "═══ SOCKS5 Proxy ═══"
  echo ""
  echo "  socks5://$SERVER_IP:$LOCAL_SOCKS5_PORT"
  echo ""
  echo "⚠️  SOCKS5 без авторизации (для локального использования)"
  echo ""
}

show_logs() {
  echo "📜 Логи локального прокси:"
  echo ""
  echo "═══ MTProto ═══"
  docker logs --tail 50 mtproxy-local
  echo ""
  echo "═══ SOCKS5 ═══"
  docker logs --tail 50 mtproxy-local-socks5
}

generate_secret() {
  echo "🔐 Генерация нового секрета..."
  NEW_SECRET=$(openssl rand -hex 16)
  echo ""
  echo "✅ Новый секрет: $NEW_SECRET"
  echo ""
  echo "Чтобы использовать его:"
  echo "1. Добавьте в .env:"
  echo "   LOCAL_SECRET=$NEW_SECRET"
  echo ""
  echo "2. Перезапустите локальный прокси:"
  echo "   $0 restart"
  echo ""
}

# ─── Main ───
case "${1:-}" in
  start)
    start_local_proxy
    ;;
  stop)
    stop_local_proxy
    ;;
  restart)
    restart_local_proxy
    ;;
  status)
    show_status
    ;;
  links)
    show_links
    ;;
  logs)
    show_logs
    ;;
  generate)
    generate_secret
    ;;
  *)
    show_help
    ;;
esac
