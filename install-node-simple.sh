#!/bin/bash
set -e

echo "════════════════════════════════════════════════════"
echo "  MTProxy Node - Простая установка"
echo "════════════════════════════════════════════════════"
echo ""

# Проверка root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Запустите скрипт с правами root:"
    echo "   sudo bash install-node-simple.sh"
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
        echo "🗑️  Удаление старой установки..."
        cd "$INSTALL_DIR" 2>/dev/null && docker compose down 2>/dev/null || true
        cd /tmp
        rm -rf "$INSTALL_DIR"
        echo "✅ Старая установка удалена"
    else
        cd "$INSTALL_DIR"
        git pull
        echo ""
        echo "✅ Репозиторий обновлён"
        echo ""
        
        # Показываем существующий API KEY
        if [ -f "node-agent/.env" ]; then
            API_KEY=$(grep "^API_KEY=" node-agent/.env | cut -d '=' -f2)
            if [ -n "$API_KEY" ]; then
                echo "📋 Ваш API KEY:"
                echo "$API_KEY"
                echo ""
                echo "Используйте его для добавления ноды в бот:"
                echo ""
                echo "name: Node-1"
                echo "ip: $(curl -s ifconfig.me)"
                echo "api_key: $API_KEY"
                echo ""
            else
                echo "⚠️  API KEY не найден в конфигурации"
                echo "Запустите переустановку для создания нового ключа"
            fi
        fi
        exit 0
    fi
fi

echo ""
echo "📥 Клонирование репозитория..."
git clone https://github.com/goodboy34-tech/eeee.git "$INSTALL_DIR"

cd "$INSTALL_DIR"

echo ""
echo "════════════════════════════════════════════════════"
echo "  Настройка ноды"
echo "════════════════════════════════════════════════════"
echo ""

# Генерация API ключа
echo "Генерация API ключа..."
API_KEY=$(openssl rand -hex 32)
echo "🔑 API Key: $API_KEY"

# Создание конфигурации
echo ""
echo "📝 Создание конфигурации..."

mkdir -p node-agent

cat > node-agent/.env <<EOF
# API Configuration
API_KEY=$API_KEY
API_PORT=3000

# Node Environment
NODE_ENV=production
EOF

echo "✅ node-agent/.env создан"

# Создание docker-compose
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
    environment:
      - API_KEY=${API_KEY}
      - API_PORT=3000
      - NODE_ENV=production
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./data:/app/data
    ports:
      - "3000:3000"
    networks:
      - mtproxy-network

networks:
  mtproxy-network:
    driver: bridge
COMPOSE_EOF

echo "✅ docker-compose.yml создан"

# Создание .env для docker-compose
cat > .env <<EOF
API_KEY=$API_KEY
EOF

# Настройка firewall
echo ""
read -p "Настроить firewall для порта 3000? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if command -v ufw &>/dev/null; then
        ufw allow 3000/tcp comment "Node API"
        ufw allow 443/tcp comment "MTProxy"
        ufw allow 1080/tcp comment "SOCKS5"
        echo "✅ Правила UFW добавлены"
    elif command -v firewall-cmd &>/dev/null; then
        firewall-cmd --permanent --add-port=3000/tcp
        firewall-cmd --permanent --add-port=443/tcp
        firewall-cmd --permanent --add-port=1080/tcp
        firewall-cmd --reload
        echo "✅ Правила FirewallD добавлены"
    else
        echo "⚠️  Firewall не обнаружен"
    fi
fi

# Запуск
echo ""
echo "🚀 Запуск Node Agent..."
docker compose up -d --build

echo ""
echo "⏳ Ожидание запуска..."
sleep 10

echo ""
echo "📊 Статус:"
docker compose ps

# Создание глобальной команды
echo ""
echo "🔧 Создание команды 'mtproxy-node'..."

cat > /usr/local/bin/mtproxy-node <<'CMD_EOF'
#!/bin/bash
INSTALL_DIR="/opt/mtproxy-node"
[ ! -d "$INSTALL_DIR" ] && echo "❌ Node не установлен" && exit 1
cd "$INSTALL_DIR"

case "$1" in
    start)   docker compose up -d ;;
    stop)    docker compose down ;;
    restart) docker compose restart ;;
    logs)    docker compose logs -f ;;
    status)  docker compose ps ;;
    update)  docker compose down && git pull && docker compose up -d --build ;;
    *)       echo "Использование: mtproxy-node {start|stop|restart|logs|status|update}" ;;
esac
CMD_EOF

chmod +x /usr/local/bin/mtproxy-node

echo "✅ Команда создана"

echo ""
echo "════════════════════════════════════════════════════"
echo "  ✅ Node Agent установлен!"
echo "════════════════════════════════════════════════════"
echo ""
echo "📋 Добавьте ноду в бот:"
echo ""
echo "1. Откройте бота в Telegram"
echo "2. Отправьте: /add_node"
echo "3. Введите данные:"
echo ""
echo "─────────────────────────────────────────────────────"
echo "name: Node-1"
echo "ip: $EXTERNAL_IP"
echo "api_key: $API_KEY"
echo "─────────────────────────────────────────────────────"
echo ""
echo "Бот настроит прокси автоматически через API!"
echo ""
echo "📋 Команды управления:"
echo "   mtproxy-node status   - статус"
echo "   mtproxy-node logs     - логи"
echo "   mtproxy-node restart  - перезапуск"
echo ""
echo "════════════════════════════════════════════════════"
echo ""
