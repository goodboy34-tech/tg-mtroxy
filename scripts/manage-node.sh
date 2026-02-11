#!/bin/bash
# Скрипт управления MTProxy Node Agent

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

case "${1:-}" in
  start)
    echo "🚀 Запуск node-agent..."
    docker compose -f docker-compose.node.yml up -d
    echo "✅ Node-agent запущен"
    docker compose -f docker-compose.node.yml ps
    ;;

  stop)
    echo "🛑 Остановка node-agent..."
    docker compose -f docker-compose.node.yml down
    echo "✅ Node-agent остановлен"
    ;;

  restart)
    echo "🔄 Перезапуск node-agent..."
    docker compose -f docker-compose.node.yml restart
    echo "✅ Node-agent перезапущен"
    docker compose -f docker-compose.node.yml ps
    ;;

  logs)
    if [ -n "$2" ]; then
      docker compose -f docker-compose.node.yml logs -f "$2"
    else
      docker compose -f docker-compose.node.yml logs -f
    fi
    ;;

  status)
    echo "📊 Статус node-agent:"
    docker compose -f docker-compose.node.yml ps
    echo ""
    echo "📈 Использование ресурсов:"
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" \
      $(docker ps --format '{{.Names}}' | grep -E "mtproxy-(node|socks5|local)") 2>/dev/null || echo "Нет запущенных контейнеров"
    ;;

  update)
    echo "🔄 Обновление node-agent из GitHub..."
    git pull origin master
    echo "🔨 Пересборка node-agent..."
    docker compose -f docker-compose.node.yml build --no-cache
    echo "🚀 Перезапуск node-agent..."
    docker compose -f docker-compose.node.yml up -d
    echo "✅ Node-agent обновлён"
    ;;

  rebuild)
    echo "🔨 Полная пересборка node-agent..."
    docker compose -f docker-compose.node.yml down
    docker compose -f docker-compose.node.yml build --no-cache
    docker compose -f docker-compose.node.yml up -d
    echo "✅ Node-agent пересобран"
    docker compose -f docker-compose.node.yml ps
    ;;

  clean)
    echo "🧹 Очистка node-agent..."
    docker compose -f docker-compose.node.yml down -v
    docker system prune -f
    echo "✅ Очистка завершена"
    ;;

  *)
    echo ""
    echo "Использование: $0 <команда>"
    echo ""
    echo "Команды для MTProxy Node Agent:"
    echo "  start      Запустить node-agent"
    echo "  stop       Остановить node-agent"
    echo "  restart    Перезапустить node-agent"
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
