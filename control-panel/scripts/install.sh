#!/bin/bash

set -e

echo "=========================================="
echo "  MTProxy Control Panel - Установка"
echo "=========================================="
echo ""

# Проверка root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Запустите скрипт с правами root: sudo bash install.sh"
    exit 1
fi

# Проверка Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker не установлен. Устанавливаю..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    systemctl enable docker
    systemctl start docker
    echo "✅ Docker установлен"
fi

# Проверка Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose не установлен. Устанавливаю..."
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    echo "✅ Docker Compose установлен"
fi

echo ""
echo "📝 Настройка переменных окружения..."
echo ""

# Создание .env если не существует
if [ ! -f .env ]; then
    cp .env.example .env
    
    echo "Введите Telegram Bot Token (получите у @BotFather):"
    read -r BOT_TOKEN
    
    echo "Введите ID администраторов через запятую (ваш Telegram ID):"
    read -r ADMIN_IDS
    
    # Обновление .env
    sed -i "s/BOT_TOKEN=.*/BOT_TOKEN=$BOT_TOKEN/" .env
    sed -i "s/ADMIN_IDS=.*/ADMIN_IDS=$ADMIN_IDS/" .env
    
    echo "✅ .env файл создан"
else
    echo "⚠️  .env файл уже существует, пропускаю настройку"
fi

echo ""
echo "📦 Установка зависимостей..."
npm install

echo ""
echo "🔨 Сборка проекта..."
npm run build

echo ""
echo "🐳 Запуск Docker контейнера..."
docker-compose up -d --build

echo ""
echo "✅ Установка завершена!"
echo ""
echo "📊 Проверка статуса:"
docker-compose ps

echo ""
echo "📖 Полезные команды:"
echo "  docker-compose logs -f          # Просмотр логов"
echo "  docker-compose restart          # Перезапуск бота"
echo "  docker-compose down             # Остановка бота"
echo "  docker-compose up -d --build    # Пересборка и запуск"
echo ""
echo "🎉 Control Panel запущен!"
echo "Отправьте /start вашему боту в Telegram"
echo ""
