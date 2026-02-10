#!/bin/bash

set -e

echo "🚀 Установка MTProxy Management System"
echo "========================================"

# Проверка .env файла
if [ ! -f .env ]; then
    echo "❌ Файл .env не найден!"
    echo "Создайте .env файл с настройками:"
    echo ""
    echo "BOT_TOKEN=your_bot_token"
    echo "ADMIN_IDS=your_telegram_id"
    echo "LOCAL_SECRET=your_mtproto_secret"
    echo "LOCAL_WORKERS=2"
    echo "LOCAL_MTPROTO_PORT=8443"
    echo "LOCAL_SOCKS5_PORT=1081"
    exit 1
fi

echo "✅ .env файл найден"

# Создание необходимых директорий
echo "📁 Создание директорий..."
mkdir -p data
mkdir -p certs
mkdir -p socks5

# Создание конфигурации SOCKS5
if [ ! -f socks5/sockd-local.conf ]; then
    echo "📝 Создание конфигурации SOCKS5..."
    cat > socks5/sockd-local.conf << 'EOF'
logoutput: stderr

internal: 0.0.0.0 port = 1080
external: eth0

clientmethod: none
socksmethod: none

client pass {
    from: 0.0.0.0/0 to: 0.0.0.0/0
    log: error
}

socks pass {
    from: 0.0.0.0/0 to: 0.0.0.0/0
    log: error
}
EOF
    echo "✅ Конфигурация SOCKS5 создана"
fi

# Остановка старых контейнеров
echo "🛑 Остановка старых контейнеров..."
docker compose down 2>/dev/null || true

# Очистка Docker кэша
echo "🧹 Очистка Docker кэша..."
docker system prune -f

# Сборка и запуск
echo "🔨 Сборка контейнеров..."
docker compose build --no-cache

echo "🚀 Запуск сервисов..."
docker compose up -d

# Ожидание запуска
echo "⏳ Ожидание запуска контейнеров..."
sleep 5

# Проверка статуса
echo ""
echo "📊 Статус контейнеров:"
docker compose ps

echo ""
echo "📋 Логи бота:"
docker compose logs control-panel | tail -20

echo ""
echo "✅ Установка завершена!"
echo ""
echo "Команды для управления:"
echo "  docker compose ps              - статус контейнеров"
echo "  docker compose logs -f         - логи всех сервисов"
echo "  docker compose logs control-panel -f  - логи бота"
echo "  docker compose restart         - перезапуск"
echo "  docker compose down            - остановка"
echo ""
