#!/bin/bash
# Простой скрипт обновления MTProxy Node

set -e

echo "🔄 Обновление MTProxy Node до последней версии..."
echo ""

# Проверка root прав
if [ "$EUID" -ne 0 ]; then
    echo "❌ Запустите с правами root: sudo bash $0"
    exit 1
fi

# Определение директории проекта
if [ -f "docker-compose.node.yml" ]; then
    PROJECT_DIR="$(pwd)"
elif [ -d "/opt/mtproxy-node" ]; then
    PROJECT_DIR="/opt/mtproxy-node"
    cd "$PROJECT_DIR"
else
    echo "❌ Не найдена директория с проектом MTProxy"
    echo "Убедитесь, что находитесь в директории проекта или проект установлен в /opt/mtproxy-node"
    exit 1
fi

echo "📁 Рабочая директория: $PROJECT_DIR"

# Обновление кода
echo "📥 Скачивание последних изменений..."
git pull origin master

# Остановка контейнеров
echo "🛑 Остановка node-agent..."
docker compose -f docker-compose.node.yml down

# Пересборка
echo "🔨 Пересборка node-agent..."
docker compose -f docker-compose.node.yml build --no-cache

# Запуск
echo "🚀 Запуск node-agent..."
docker compose -f docker-compose.node.yml up -d

# Проверка
echo "✅ Проверка статуса..."
docker compose -f docker-compose.node.yml ps

echo ""
echo "🎉 Обновление завершено!"
echo "Последняя версия установлена с поддержкой Dante SOCKS5."
