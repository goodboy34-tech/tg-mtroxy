#!/bin/bash

set -e

echo "=========================================="
echo "  MTProxy Node Agent - Установка"
echo "=========================================="
echo ""

# Проверка root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Запустите скрипт с правами root: sudo bash install.sh"
    exit 1
fi

# Получение внешнего IP
EXTERNAL_IP=$(curl -s ifconfig.me || echo "")
if [ -z "$EXTERNAL_IP" ]; then
    echo "⚠️  Не удалось определить внешний IP автоматически"
    read -p "Введите внешний IP сервера: " EXTERNAL_IP
fi

echo "🌍 Внешний IP: $EXTERNAL_IP"
echo ""

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
    
    echo "Введите имя ноды (например: Node1):"
    read -r NODE_NAME
    
    echo "Введите домен (например: proxy.example.com):"
    read -r DOMAIN
    
    echo "Генерация API ключа..."
    API_KEY=$(openssl rand -hex 32)
    echo "✅ API Key: $API_KEY"
    echo "⚠️  СОХРАНИТЕ ЕГО! Потребуется для добавления ноды в Control Panel"
    
    echo "Генерация MTProxy секрета..."
    SECRET=$(openssl rand -hex 16)
    
    echo "Введите количество воркеров (1-16, рекомендуется 4):"
    read -r WORKERS
    WORKERS=${WORKERS:-4}
    
    # Обновление .env
    sed -i "s/NODE_NAME=.*/NODE_NAME=$NODE_NAME/" .env
    sed -i "s/DOMAIN=.*/DOMAIN=$DOMAIN/" .env
    sed -i "s/API_KEY=.*/API_KEY=$API_KEY/" .env
    sed -i "s/SECRET=.*/SECRET=$SECRET/" .env
    sed -i "s/WORKERS=.*/WORKERS=$WORKERS/" .env
    
    # Определение NAT
    INTERNAL_IP=$(hostname -I | awk '{print $1}')
    if [ "$INTERNAL_IP" != "$EXTERNAL_IP" ]; then
        echo "🔧 Обнаружен NAT, настраиваю..."
        sed -i "s/NAT=.*/NAT=$EXTERNAL_IP/" .env
    fi
    
    echo "✅ .env файл создан"
    echo ""
    echo "📋 Конфигурация:"
    echo "  Имя: $NODE_NAME"
    echo "  Домен: $DOMAIN"
    echo "  API Key: $API_KEY"
    echo "  Воркеры: $WORKERS"
    echo "  IP: $EXTERNAL_IP"
else
    echo "⚠️  .env файл уже существует, пропускаю настройку"
    source .env
fi

echo ""
echo "🔥 Настройка Firewall..."
ufw allow $MTPROTO_PORT/tcp comment "MTProxy"
ufw allow $SOCKS5_PORT/tcp comment "SOCKS5"
ufw allow $API_PORT/tcp comment "Node API"
echo "✅ Firewall настроен"

echo ""
echo "📦 Установка зависимостей..."
npm install

echo ""
echo "🔨 Сборка проекта..."
npm run build

echo ""
echo "🐳 Запуск Docker контейнеров..."
docker-compose up -d --build

echo ""
echo "⏳ Ожидание запуска сервисов (10 секунд)..."
sleep 10

echo ""
echo "✅ Установка завершена!"
echo ""
echo "📊 Проверка статуса:"
docker-compose ps

echo ""
echo "🔗 API доступен по адресу:"
echo "  https://$EXTERNAL_IP:$API_PORT"
echo ""
echo "🔑 Для добавления ноды в Control Panel используйте:"
echo "  /add_node $NODE_NAME $DOMAIN https://$EXTERNAL_IP:$API_PORT $API_KEY"
echo ""
echo "📖 Полезные команды:"
echo "  docker-compose logs -f          # Просмотр логов"
echo "  docker-compose restart          # Перезапуск"
echo "  docker-compose down             # Остановка"
echo "  docker-compose up -d --build    # Пересборка"
echo ""
echo "🎉 Node Agent запущен!"
echo ""
