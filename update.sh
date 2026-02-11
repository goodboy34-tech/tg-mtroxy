#!/bin/bash

echo "=== Обновление MTProxy Control Panel ==="

# Обновление кода из GitHub
echo "Обновляем код из GitHub..."
git pull origin master

# Остановка всех контейнеров
echo "Останавливаем контейнеры..."
docker compose -f docker-compose.yml down
docker compose -f docker-compose.node.yml down

# Очистка Docker кэша
echo "Очищаем Docker кэш..."
docker system prune -a -f

# Пересборка образов
echo "Пересобираем control-panel..."
docker compose -f docker-compose.yml build --no-cache

echo "Пересобираем node-agent..."
docker compose -f docker-compose.node.yml build --no-cache

# Запуск сервисов
echo "Запускаем сервисы..."
docker compose -f docker-compose.yml up -d
docker compose -f docker-compose.node.yml up -d

# Проверка статуса
echo "Проверяем статус..."
docker ps

echo "=== Обновление завершено ==="
echo "Проверьте логи командой:"
echo "docker logs mtproxy-control"
echo "docker logs mtproxy-socks5"
