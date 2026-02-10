#!/bin/bash

set -e

echo "=========================================="
echo "  MTProxy Node Agent - Удаление"
echo "=========================================="
echo ""

# Проверка root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Запустите скрипт с правами root: sudo bash uninstall.sh"
    exit 1
fi

echo "⚠️  ВНИМАНИЕ! Это удалит:"
echo "   - Все Docker контейнеры (node-agent, mtproxy, socks5)"
echo "   - Docker образы"
echo "   - Все файлы проекта"
echo "   - Правила Firewall"
echo ""
read -p "Сохранить конфигурацию (.env)? (y/n): " -n 1 -r KEEP_CONFIG
echo ""

if [[ ! $KEEP_CONFIG =~ ^[Yy]$ ]]; then
    KEEP_CONFIG="n"
fi

read -p "Продолжить удаление? (y/n): " -n 1 -r CONFIRM
echo ""

if [[ ! $CONFIRM =~ ^[Yy]$ ]]; then
    echo "❌ Удаление отменено"
    exit 0
fi

# Загрузка конфигурации для портов
if [ -f .env ]; then
    source .env
fi

MTPROTO_PORT=${MTPROTO_PORT:-443}
SOCKS5_PORT=${SOCKS5_PORT:-1080}
API_PORT=${API_PORT:-3001}

echo ""
echo "🛑 Остановка контейнеров..."
docker-compose down || true

echo ""
echo "🗑️  Удаление Docker образов..."
docker rmi node-agent-node-agent:latest 2>/dev/null || true
docker rmi node-agent-mtproxy:latest 2>/dev/null || true
docker rmi node-agent-socks5:latest 2>/dev/null || true

echo ""
echo "🔥 Удаление правил Firewall..."
ufw delete allow $MTPROTO_PORT/tcp 2>/dev/null || true
ufw delete allow $SOCKS5_PORT/tcp 2>/dev/null || true
ufw delete allow $API_PORT/tcp 2>/dev/null || true
echo "✅ Правила Firewall удалены"

if [[ $KEEP_CONFIG =~ ^[Yy]$ ]]; then
    echo ""
    echo "💾 Создание резервной копии конфигурации..."
    BACKUP_DIR="$HOME/mtproxy-node-backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    cp .env "$BACKUP_DIR/" 2>/dev/null || true
    echo "✅ Конфигурация сохранена в: $BACKUP_DIR"
fi

echo ""
echo "🗑️  Удаление файлов проекта..."
cd ..
INSTALL_DIR=$(pwd)
cd ..
rm -rf "$INSTALL_DIR"

echo ""
echo "✅ Node Agent полностью удален!"

if [[ $KEEP_CONFIG =~ ^[Yy]$ ]]; then
    echo ""
    echo "💾 Резервная копия конфигурации: $BACKUP_DIR"
fi

echo ""
echo "Для повторной установки:"
echo "  git clone <repository>"
echo "  cd node-agent"
echo "  sudo bash scripts/install.sh"
echo ""
