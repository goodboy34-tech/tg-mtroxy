#!/bin/bash

set -e

echo "=========================================="
echo "  MTProxy Control Panel - Удаление"
echo "=========================================="
echo ""

# Проверка root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Запустите скрипт с правами root: sudo bash uninstall.sh"
    exit 1
fi

echo "⚠️  ВНИМАНИЕ! Это удалит:"
echo "   - Docker контейнер control-panel"
echo "   - Docker образ control-panel"
echo "   - Все файлы проекта"
echo ""
read -p "Сохранить базу данных? (y/n): " -n 1 -r KEEP_DB
echo ""

if [[ ! $KEEP_DB =~ ^[Yy]$ ]]; then
    KEEP_DB="n"
fi

read -p "Продолжить удаление? (y/n): " -n 1 -r CONFIRM
echo ""

if [[ ! $CONFIRM =~ ^[Yy]$ ]]; then
    echo "❌ Удаление отменено"
    exit 0
fi

echo ""
echo "🛑 Остановка контейнера..."
docker-compose down || true

echo ""
echo "🗑️  Удаление Docker образа..."
docker rmi mtproxy-control-panel:latest 2>/dev/null || true
docker rmi control-panel-control-panel:latest 2>/dev/null || true

if [[ $KEEP_DB =~ ^[Yy]$ ]]; then
    echo ""
    echo "💾 Создание резервной копии базы данных..."
    BACKUP_DIR="$HOME/mtproxy-backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    cp -r ./data "$BACKUP_DIR/" 2>/dev/null || true
    echo "✅ База данных сохранена в: $BACKUP_DIR"
fi

echo ""
echo "🗑️  Удаление файлов проекта..."
cd ..
INSTALL_DIR=$(pwd)
cd ..
rm -rf "$INSTALL_DIR"

echo ""
echo "✅ Control Panel полностью удален!"

if [[ $KEEP_DB =~ ^[Yy]$ ]]; then
    echo ""
    echo "💾 Резервная копия базы данных: $BACKUP_DIR"
fi

echo ""
echo "Для повторной установки:"
echo "  git clone <repository>"
echo "  cd control-panel"
echo "  sudo bash scripts/install.sh"
echo ""
