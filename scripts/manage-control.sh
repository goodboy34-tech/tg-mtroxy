#!/bin/bash
# Скрипт управления MTProxy Control Panel

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

case "${1:-}" in
  start)
    echo "🚀 Запуск control-panel..."
    docker compose -f docker-compose.yml up -d
    echo "✅ Control-panel запущен"
    docker compose -f docker-compose.yml ps
    ;;

  stop)
    echo "🛑 Остановка control-panel..."
    docker compose -f docker-compose.yml down
    echo "✅ Control-panel остановлен"
    ;;

  restart)
    echo "🔄 Перезапуск control-panel..."
    docker compose -f docker-compose.yml restart
    echo "✅ Control-panel перезапущен"
    docker compose -f docker-compose.yml ps
    ;;

  logs)
    if [ -n "$2" ]; then
      docker compose -f docker-compose.yml logs -f "$2"
    else
      docker compose -f docker-compose.yml logs -f
    fi
    ;;

  status)
    echo "📊 Статус control-panel:"
    docker compose -f docker-compose.yml ps
    echo ""
    echo "📈 Использование ресурсов:"
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" \
      $(docker ps --format '{{.Names}}' | grep mtproxy-control) 2>/dev/null || echo "Нет запущенных контейнеров"
    ;;

  update)
    echo "🔄 Обновление control-panel из GitHub..."
    git pull origin master
    echo "🔨 Пересборка control-panel..."
    docker compose -f docker-compose.yml build --no-cache
    echo "🚀 Перезапуск control-panel..."
    docker compose -f docker-compose.yml up -d
    echo "✅ Control-panel обновлён"
    ;;

  rebuild)
    echo "🔨 Полная пересборка control-panel..."
    docker compose -f docker-compose.yml down
    docker compose -f docker-compose.yml build --no-cache
    docker compose -f docker-compose.yml up -d
    echo "✅ Control-panel пересобран"
    docker compose -f docker-compose.yml ps
    ;;

  clean)
    echo "🧹 Очистка control-panel..."
    docker compose -f docker-compose.yml down -v
    docker system prune -f
    echo "✅ Очистка завершена"
    ;;

  *)
    echo ""
    echo "Использование: $0 <команда>"
    echo ""
    echo "Команды для MTProxy Control Panel:"
    echo "  start      Запустить control-panel"
    echo "  stop       Остановить control-panel"
    echo "  restart    Перезапустить control-panel"
    echo "  logs [service]  Показать логи"
    echo "  status     Показать статус и ресурсы"
    echo "  update     Обновить из GitHub и перезапустить"
    echo "  rebuild    Полная пересборка"
    echo "  clean      Очистить Docker"
    echo ""
    echo "Примеры:"
    echo "  $0 start"
    echo "  $0 logs"
    echo "  $0 status"
    exit 1
    ;;
esac
