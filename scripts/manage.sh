#!/bin/bash
# Скрипт управления MTProxy системой

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

case "${1:-}" in
  start)
    echo "🚀 Запуск всех сервисов..."
    docker compose -f docker-compose.yml up -d
    docker compose -f docker-compose.node.yml up -d
    echo "✅ Сервисы запущены"
    docker compose -f docker-compose.yml ps
    docker compose -f docker-compose.node.yml ps
    ;;
    
  stop)
    echo "🛑 Остановка всех сервисов..."
    docker compose -f docker-compose.yml down
    docker compose -f docker-compose.node.yml down
    echo "✅ Сервисы остановлены"
    ;;
    
  restart)
    echo "🔄 Перезапуск всех сервисов..."
    docker compose -f docker-compose.yml restart
    docker compose -f docker-compose.node.yml restart
    echo "✅ Сервисы перезапущены"
    docker compose -f docker-compose.yml ps
    docker compose -f docker-compose.node.yml ps
    ;;
    
  logs)
    if [ -n "$2" ]; then
      docker compose logs -f "$2"
    else
      docker compose logs -f
    fi
    ;;
    
  status)
    echo "📊 Статус сервисов:"
    docker compose -f docker-compose.yml ps
    docker compose -f docker-compose.node.yml ps
    echo ""
    echo "📈 Использование ресурсов:"
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" \
      $(docker ps --format '{{.Names}}' | grep mtproxy) 2>/dev/null || docker stats --no-stream
    ;;
    
  update)
    echo "🔄 Обновление из GitHub..."
    git pull origin master
    echo "🔨 Пересборка контейнеров..."
    docker compose -f docker-compose.yml build --no-cache
    docker compose -f docker-compose.node.yml build --no-cache
    echo "🚀 Перезапуск..."
    docker compose -f docker-compose.yml up -d
    docker compose -f docker-compose.node.yml up -d
    echo "✅ Обновление завершено"
    ;;
    
  rebuild)
    echo "🔨 Полная пересборка..."
    docker compose -f docker-compose.yml down
    docker compose -f docker-compose.node.yml down
    docker compose -f docker-compose.yml build --no-cache
    docker compose -f docker-compose.node.yml build --no-cache
    docker compose -f docker-compose.yml up -d
    docker compose -f docker-compose.node.yml up -d
    echo "✅ Пересборка завершена"
    docker compose -f docker-compose.yml ps
    docker compose -f docker-compose.node.yml ps
    ;;
    
  clean)
    echo "🧹 Очистка Docker..."
    docker compose -f docker-compose.yml down -v
    docker compose -f docker-compose.node.yml down -v
    docker system prune -af
    echo "✅ Очистка завершена"
    ;;
    
  backup)
    BACKUP_DIR="$PROJECT_ROOT/backups"
    mkdir -p "$BACKUP_DIR"
    BACKUP_FILE="$BACKUP_DIR/backup-$(date +%Y%m%d-%H%M%S).tar.gz"
    echo "💾 Создание резервной копии..."
    tar -czf "$BACKUP_FILE" -C "$PROJECT_ROOT" \
      data/ .env 2>/dev/null || true
    echo "✅ Резервная копия: $BACKUP_FILE"
    ;;
    
  *)
    echo "MTProxy Management System - Управление"
    echo ""
    echo "Использование: $0 <команда>"
    echo ""
    echo "Команды:"
    echo "  start      Запустить все сервисы"
    echo "  stop       Остановить все сервисы"
    echo "  restart    Перезапустить все сервисы"
    echo "  logs [service]  Показать логи (опционально конкретного сервиса)"
    echo "  status     Показать статус и использование ресурсов"
    echo "  update     Обновить из GitHub и перезапустить"
    echo "  rebuild    Полная пересборка контейнеров"
    echo "  clean      Очистить Docker (удалит volumes!)"
    echo "  backup     Создать резервную копию данных"
    echo ""
    echo "Примеры:"
    echo "  $0 start"
    echo "  $0 logs control-panel"
    echo "  $0 status"
    exit 1
    ;;
esac
