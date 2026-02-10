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

echo ""
echo "════════════════════════════════════════════════════"
echo "  Настройка ноды"
echo "════════════════════════════════════════════════════"
echo ""

# Запрос данных у пользователя
read -p "Введите имя ноды (например: Node-Moscow): " NODE_NAME
NODE_NAME=${NODE_NAME:-"Node-$(hostname)"}

read -p "Введите домен или IP [$EXTERNAL_IP]: " DOMAIN
DOMAIN=${DOMAIN:-$EXTERNAL_IP}

echo ""
echo "Генерация API ключа..."
API_KEY=$(openssl rand -hex 32)
echo "🔑 API Key: $API_KEY"

echo ""
echo "Генерация MTProxy секрета..."
SECRET=$(openssl rand -hex 16)
echo "🔐 Secret: $SECRET"

echo ""
read -p "Введите количество воркеров (1-16, рекомендуется 2-4): " WORKERS
WORKERS=${WORKERS:-2}

# Определение NAT
INTERNAL_IP=$(hostname -I | awk '{print $1}')
NAT=""
if [ "$INTERNAL_IP" != "$EXTERNAL_IP" ]; then
    echo ""
    echo "🔧 Обнаружен NAT (внутренний IP: $INTERNAL_IP)"
    NAT="$INTERNAL_IP:$EXTERNAL_IP"
fi

# Создание .env для node-agent
echo ""
echo "📝 Создание конфигурации node-agent..."

cat > node-agent/.env <<EOF
# Node Configuration
NODE_NAME=$NODE_NAME
DOMAIN=$DOMAIN
API_KEY=$API_KEY

# Ports
MTPROTO_PORT=443
SOCKS5_PORT=1080
API_PORT=3001

# MTProxy Settings
WORKERS=$WORKERS
SECRET=$SECRET

# Network
NAT=$NAT

# Optional: Fake-TLS Domain
FAKE_TLS_DOMAIN=www.google.com
EOF

echo "✅ Конфигурация создана: node-agent/.env"

# Создание docker-compose для standalone ноды
echo ""
echo "📝 Создание docker-compose.yml..."

cat > docker-compose.yml <<'COMPOSE_EOF'
services:
  node-agent:
    build:
      context: ./node-agent
      dockerfile: Dockerfile
    container_name: mtproxy-node-agent
    restart: unless-stopped
    env_file:
      - ./node-agent/.env
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/app/data
      - ./certs:/app/certs:ro
    ports:
      - "${API_PORT:-3001}:3001"
    networks:
      - mtproxy-network
    depends_on:
      - mtproxy
      - socks5

  mtproxy:
    image: telegrammessenger/proxy:latest
    container_name: mtproxy
    restart: unless-stopped
    environment:
      - SECRET=${SECRET}
      - SECRET_COUNT=1
      - WORKERS=${WORKERS:-2}
    volumes:
      - mtproxy-config:/data
    ports:
      - "${MTPROTO_PORT:-443}:443"
      - "2398:2398"
    networks:
      - mtproxy-network

  socks5:
    image: tarampampam/3proxy:latest
    container_name: mtproxy-socks5
    restart: unless-stopped
    volumes:
      - ./socks5/3proxy.cfg:/etc/3proxy/3proxy.cfg:ro
    ports:
      - "${SOCKS5_PORT:-1080}:1080"
    networks:
      - mtproxy-network

volumes:
  mtproxy-config:

networks:
  mtproxy-network:
    driver: bridge
COMPOSE_EOF

echo "✅ docker-compose.yml создан"

# Создание конфигурации SOCKS5
echo ""
echo "📝 Создание конфигурации SOCKS5..."
mkdir -p socks5

cat > socks5/3proxy.cfg <<'SOCKS5_EOF'
nserver 1.1.1.1
nserver 8.8.8.8

nscache 65536
timeouts 1 5 30 60 180 1800 15 60

auth none

allow *

proxy -p1080 -n -a
SOCKS5_EOF

echo "✅ Конфигурация SOCKS5 создана"

# Настройка firewall
echo ""
echo "🔥 Настройка firewall..."
if command -v ufw &>/dev/null; then
    ufw allow 443/tcp comment "MTProxy"
    ufw allow 1080/tcp comment "SOCKS5"
    ufw allow 3001/tcp comment "Node API"
    echo "✅ Правила UFW добавлены"
elif command -v firewall-cmd &>/dev/null; then
    firewall-cmd --permanent --add-port=443/tcp
    firewall-cmd --permanent --add-port=1080/tcp
    firewall-cmd --permanent --add-port=3001/tcp
    firewall-cmd --reload
    echo "✅ Правила FirewallD добавлены"
else
    echo "⚠️  Firewall не обнаружен, настройте вручную:"
    echo "   Порты: 443, 1080, 3001"
fi

# Запуск контейнеров
echo ""
echo "🚀 Запуск MTProxy Node..."
docker compose up -d --build

echo ""
echo "⏳ Ожидание запуска контейнеров..."
sleep 10

# Проверка статуса
echo ""
echo "📊 Статус контейнеров:"
docker compose ps

# Получение секрета из логов MTProxy
echo ""
echo "🔍 Получение MTProxy ссылки..."
sleep 3
SECRET_LINE=$(docker logs mtproxy 2>&1 | grep -E "tg://|t.me/proxy" | head -1 || echo "")

echo ""
echo "════════════════════════════════════════════════════"
echo "  ✅ MTProxy Node успешно установлен!"
echo "════════════════════════════════════════════════════"
echo ""
echo "📋 Информация для добавления в Control Panel:"
echo ""
echo "   Имя: $NODE_NAME"
echo "   Домен: $DOMAIN"
echo "   IP: $EXTERNAL_IP"
echo "   API URL: http://$EXTERNAL_IP:3001"
echo "   API Key: $API_KEY"
echo ""
echo "🤖 В боте отправьте /add_node и укажите:"
echo ""
echo "name: $NODE_NAME"
echo "domain: $DOMAIN"
echo "ip: $EXTERNAL_IP"
echo "api_url: http://$EXTERNAL_IP:3001"
echo "mtproto_port: 443"
echo "socks5_port: 1080"
echo "workers: $WORKERS"
echo "cpu_cores: 2"
echo "ram_mb: 2048"
echo ""
echo "Затем в боте получите API TOKEN и добавьте в node-agent/.env:"
echo "   echo 'API_TOKEN=YOUR_TOKEN_FROM_BOT' >> node-agent/.env"
echo ""
echo "🔗 MTProxy ссылка:"
if [ -n "$SECRET_LINE" ]; then
    echo "   $SECRET_LINE"
else
    echo "   Смотрите логи: docker logs mtproxy | grep 't.me/proxy'"
fi
echo ""
echo "📊 Проверка статуса:"
echo "   docker compose ps"
echo ""
echo "📜 Просмотр логов:"
echo "   docker compose logs -f"
echo ""
echo "🔄 Перезапуск:"
echo "   cd $INSTALL_DIR"
echo "   docker compose restart"
echo ""
echo "🛑 Остановка:"
echo "   docker compose down"
echo ""
echo "════════════════════════════════════════════════════"
echo ""
echo "⚠️  СОХРАНИТЕ API KEY! Он нужен для добавления ноды в Control Panel."
echo ""
