#!/bin/bash
set -e

echo "════════════════════════════════════════════════════"
echo "  MTProxy Node - Быстрая установка"
echo "════════════════════════════════════════════════════"
echo ""

# Проверка root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Запустите скрипт с правами root:"
    echo "   curl -fsSL https://raw.githubusercontent.com/goodboy34-tech/eeee/master/install-node.sh | sudo bash"
    exit 1
fi

# Установка Docker
if ! command -v docker &>/dev/null; then
    echo "📦 Установка Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "✅ Docker установлен"
else
    echo "✅ Docker уже установлен: $(docker --version)"
fi

# Проверка Docker Compose
if ! docker compose version &>/dev/null; then
    echo "❌ Docker Compose не найден. Обновите Docker до версии с встроенным Compose."
    exit 1
fi

echo "✅ Docker Compose: $(docker compose version)"

# Определение IP
echo ""
echo "🔍 Определение IP адреса..."
EXTERNAL_IP=$(curl -s ifconfig.me || curl -s api.ipify.org || echo "")
if [ -z "$EXTERNAL_IP" ]; then
    echo "⚠️  Не удалось определить IP автоматически"
    read -p "Введите внешний IP этого сервера: " EXTERNAL_IP
fi
echo "📡 Внешний IP: $EXTERNAL_IP"

# Клонирование репозитория
INSTALL_DIR="/opt/mtproxy-node"
if [ -d "$INSTALL_DIR" ]; then
    echo ""
    echo "⚠️  Директория $INSTALL_DIR уже существует"
    read -p "Переустановить? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$INSTALL_DIR"
    else
        cd "$INSTALL_DIR"
        git pull
    fi
fi

if [ ! -d "$INSTALL_DIR" ]; then
    echo ""
    echo "📥 Клонирование репозитория..."
    git clone https://github.com/goodboy34-tech/eeee.git "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# Запрос API токена
echo ""
echo "════════════════════════════════════════════════════"
echo "  Добавление ноды в Control Panel"
echo "════════════════════════════════════════════════════"
echo ""
echo "Сначала добавьте ноду через бота:"
echo "1. Откройте бота в Telegram"
echo "2. Отправьте команду: /add_node"
echo "3. Отправьте данные ноды в формате:"
echo ""
echo "   name: My Node 1"
echo "   domain: $EXTERNAL_IP"
echo "   ip: $EXTERNAL_IP"
echo "   api_url: http://$EXTERNAL_IP:9090"
echo "   mtproto_port: 8443"
echo "   socks5_port: 9080"
echo "   workers: 2"
echo "   cpu_cores: 2"
echo "   ram_mb: 2048"
echo ""
echo "4. Бот выдаст API токен, скопируйте его"
echo ""
read -p "Введите API токен от бота: " API_TOKEN

if [ -z "$API_TOKEN" ]; then
    echo "❌ API токен не может быть пустым!"
    exit 1
fi

# Создание .env для ноды
echo ""
echo "📝 Создание конфигурации..."

cat > .env.node <<EOF
# API токен для подключения к Control Panel
API_TOKEN=$API_TOKEN

# IP и домен сервера
DOMAIN=$EXTERNAL_IP
INTERNAL_IP=

# Количество воркеров MTProxy
WORKERS=2

# Автогенерируемые параметры
SECRET=
SECRET_COUNT=1
TAG=
EOF

echo "✅ Конфигурация создана: .env.node"

# Настройка firewall
echo ""
echo "🔥 Настройка firewall..."
if command -v ufw &>/dev/null; then
    ufw allow 8443/tcp comment "MTProxy Node"
    ufw allow 9080/tcp comment "SOCKS5 Node"
    ufw allow 9090/tcp comment "Node API"
    echo "✅ Правила UFW добавлены"
elif command -v firewall-cmd &>/dev/null; then
    firewall-cmd --permanent --add-port=8443/tcp
    firewall-cmd --permanent --add-port=9080/tcp
    firewall-cmd --permanent --add-port=9090/tcp
    firewall-cmd --reload
    echo "✅ Правила FirewallD добавлены"
else
    echo "⚠️  Firewall не обнаружен, настройте вручную:"
    echo "   Порты: 8443, 9080, 9090"
fi

# Запуск контейнеров
echo ""
echo "🚀 Запуск MTProxy Node..."
docker compose -f docker-compose.node.yml --env-file .env.node up -d

echo ""
echo "⏳ Ожидание запуска контейнеров..."
sleep 5

# Проверка статуса
echo ""
echo "📊 Статус контейнеров:"
docker compose -f docker-compose.node.yml ps

# Получение секрета из логов MTProxy
echo ""
echo "🔍 Получение MTProxy секрета..."
sleep 3
SECRET_LINE=$(docker logs mtproxy-local 2>&1 | grep "tg://" | head -1 || echo "")

echo ""
echo "════════════════════════════════════════════════════"
echo "  ✅ MTProxy Node успешно установлен!"
echo "════════════════════════════════════════════════════"
echo ""
echo "📋 Информация:"
echo "   IP: $EXTERNAL_IP"
echo "   MTProxy порт: 8443"
echo "   SOCKS5 порт: 9080"
echo "   API порт: 9090"
echo ""
echo "🔗 MTProxy ссылка:"
if [ -n "$SECRET_LINE" ]; then
    echo "   $SECRET_LINE"
else
    echo "   Смотрите логи: docker logs mtproxy-local | grep 't.me/proxy'"
fi
echo ""
echo "📊 Проверка статуса:"
echo "   docker compose -f docker-compose.node.yml ps"
echo ""
echo "📜 Просмотр логов:"
echo "   docker compose -f docker-compose.node.yml logs -f"
echo ""
echo "🔄 Перезапуск:"
echo "   cd $INSTALL_DIR"
echo "   docker compose -f docker-compose.node.yml restart"
echo ""
echo "🛑 Остановка:"
echo "   docker compose -f docker-compose.node.yml down"
echo ""
echo "════════════════════════════════════════════════════"
echo ""
