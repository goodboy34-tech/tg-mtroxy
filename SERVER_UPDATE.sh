#!/bin/bash
# Скрипт для ПОЛНОГО обновления node-agent на сервере

set -e

echo "🔄 Полное обновление Node Agent"
echo "================================"

# 1. Остановить все контейнеры
echo "1️⃣ Остановка всех контейнеров..."
docker stop mtproxy-node-agent mtproxy mtproxy-socks5 2>/dev/null || true
docker rm mtproxy-node-agent mtproxy mtproxy-socks5 2>/dev/null || true

# 2. Удалить старые образы
echo "2️⃣ Удаление старых образов..."
docker rmi tg-mtproxy-node-agent 2>/dev/null || true
docker rmi $(docker images -q --filter "dangling=true") 2>/dev/null || true

# 3. Обновить код из git
echo "3️⃣ Обновление кода из GitHub..."
git fetch origin
git reset --hard origin/master
git clean -fd

# 4. Проверить что код обновлён
echo "4️⃣ Проверка кода..."
if grep -q "docker-compose.yml" node-agent/src/api.ts; then
    echo "❌ ОШИБКА: Старый код всё ещё присутствует!"
    echo "Файл node-agent/src/api.ts содержит упоминание docker-compose.yml"
    exit 1
fi
echo "✅ Код обновлён корректно"

# 5. Пересобрать БЕЗ КЭША
echo "5️⃣ Пересборка образов БЕЗ КЭША..."
cd /root/eeee  # Или ваш путь к репозиторию
docker compose -f docker-compose.node.yml build --no-cache node-agent

# 6. Запустить контейнеры
echo "6️⃣ Запуск контейнеров..."
docker compose -f docker-compose.node.yml up -d

# 7. Проверить запуск
echo "7️⃣ Проверка состояния..."
sleep 5
docker ps | grep node-agent

# 8. Проверить логи
echo "8️⃣ Проверка логов..."
docker logs --tail=50 mtproxy-node-agent

echo ""
echo "✅ Обновление завершено!"
echo ""
echo "Проверьте API:"
echo "  curl -H 'Authorization: Bearer YOUR_API_TOKEN' http://localhost:3000/health"
echo ""
echo "Если всё работает, попробуйте добавить SOCKS5 через бота"
