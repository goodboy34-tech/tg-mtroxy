#!/bin/bash
set -e

echo "════════════════════════════════════════════════════"
echo "  MTProxy Node - Установка"
echo "════════════════════════════════════════════════════"
echo ""

# Проверка root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Запустите скрипт с правами root:"
    echo "   sudo bash install-node.sh"
    exit 1
fi

# Функция для настройки после установки
setup_api_token() {
    echo ""
    echo "════════════════════════════════════════════════════"
    echo "  Добавление API TOKEN от бота"
    echo "════════════════════════════════════════════════════"
    echo ""
    
    read -p "Введите API TOKEN от бота: " API_TOKEN
    
    if [ -z "$API_TOKEN" ]; then
        echo "❌ API TOKEN не может быть пустым!"
        return 1
    fi
    
    # Добавляем API_TOKEN в .env
    if grep -q "^API_TOKEN=" node-agent/.env 2>/dev/null; then
        sed -i "s/^API_TOKEN=.*/API_TOKEN=$API_TOKEN/" node-agent/.env
        echo "✅ API TOKEN обновлён"
    else
        echo "API_TOKEN=$API_TOKEN" >> node-agent/.env
        echo "✅ API TOKEN добавлен"
    fi
    
    # Перезапускаем node-agent
    echo ""
    echo "🔄 Перезапуск node-agent..."
    docker compose restart node-agent
    
    echo ""
    echo "✅ Готово! Проверьте подключение:"
    echo "   docker compose logs -f node-agent"
    echo ""
}

# Проверяем аргументы командной строки
if [ "$1" = "setup" ]; then
    # Если запущен из произвольной директории, переходим в install dir
    if [ -d "/opt/mtproxy-node" ]; then
        cd /opt/mtproxy-node
    else
        echo "❌ Node не установлен в /opt/mtproxy-node"
        exit 1
    fi
    
    # Проверяем наличие docker-compose.yml
    if [ ! -f "docker-compose.yml" ]; then
        echo "❌ docker-compose.yml не найден"
        echo "   Запустите полную переустановку:"
        echo "   curl -fsSL https://raw.githubusercontent.com/goodboy34-tech/eeee/master/install-node.sh | sudo bash"
        exit 1
    fi
    
    setup_api_token
    exit 0
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
        # Останавливаем контейнеры если они запущены
        cd "$INSTALL_DIR" 2>/dev/null && docker compose down 2>/dev/null || true
        # Переходим в безопасную директорию перед удалением
        cd /tmp
        rm -rf "$INSTALL_DIR"
        echo "✅ Старая установка удалена"
    else
        cd "$INSTALL_DIR"
        git pull
        echo ""
        echo "✅ Репозиторий обновлён"
        echo ""
        
        # Проверяем структуру файлов
        if [ ! -f "docker-compose.yml" ] || [ ! -f "node-agent/.env" ]; then
            echo "⚠️  Обнаружена старая структура файлов"
            echo ""
            read -p "Хотите пересоздать конфигурацию? (y/n): " -n 1 -r
            echo
            if [[ $REPLY =~ ^[Yy]$ ]]; then
                echo ""
                echo "🗑️  Очистка старых файлов..."
                docker compose down 2>/dev/null || true
                cd /tmp
                rm -rf "$INSTALL_DIR"
                # Рекурсивно вызываем себя для чистой установки
                exec bash -c "$(curl -fsSL https://raw.githubusercontent.com/goodboy34-tech/eeee/master/install-node.sh)"
            else
                echo ""
                echo "Для добавления API TOKEN запустите:"
                echo "   mtproxy-node setup"
                echo ""
                echo "⚠️  Внимание: старая структура может не работать"
                echo "   Рекомендуется полная переустановка"
                exit 0
            fi
        fi
        
        echo "Для добавления API TOKEN запустите:"
        echo "   mtproxy-node setup"
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

echo ""
read -p "Введите количество CPU ядер [2]: " CPU_CORES
CPU_CORES=${CPU_CORES:-2}

echo ""
read -p "Введите объём RAM в MB [2048]: " RAM_MB
RAM_MB=${RAM_MB:-2048}

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

# API Token (добавится после регистрации в боте)
# API_TOKEN=
EOF

echo "✅ Конфигурация создана: node-agent/.env"

# Создание .env в корне для docker-compose
echo ""
echo "📝 Создание .env для docker-compose..."

cat > .env <<EOF
# Переменные из node-agent/.env для docker-compose
SECRET=$SECRET
WORKERS=$WORKERS
MTPROTO_PORT=443
SOCKS5_PORT=1080
API_PORT=3001
EOF

echo "✅ .env создан"

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
    env_file:
      - .env
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
    env_file:
      - .env
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
read -p "Настроить firewall автоматически? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
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
else
    echo "⚠️  Не забудьте открыть порты вручную:"
    echo "   443/tcp  - MTProxy"
    echo "   1080/tcp - SOCKS5"
    echo "   3001/tcp - Node API"
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

# Создание глобальной команды управления
echo ""
echo "🔧 Создание глобальной команды 'mtproxy-node'..."

cat > /usr/local/bin/mtproxy-node <<'NODE_SCRIPT_EOF'
#!/bin/bash

INSTALL_DIR="/opt/mtproxy-node"

if [ ! -d "$INSTALL_DIR" ]; then
    echo "❌ Node не установлен в $INSTALL_DIR"
    exit 1
fi

cd "$INSTALL_DIR"

case "$1" in
    start)
        echo "🚀 Запуск Node..."
        docker compose up -d
        ;;
    stop)
        echo "🛑 Остановка Node..."
        docker compose down
        ;;
    restart)
        echo "🔄 Перезапуск Node..."
        docker compose restart
        ;;
    logs)
        if [ -n "$2" ]; then
            docker compose logs -f "$2"
        else
            docker compose logs -f
        fi
        ;;
    status)
        echo "📊 Статус Node:"
        docker compose ps
        echo ""
        echo "📈 Использование ресурсов:"
        docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" \
          $(docker compose ps -q) 2>/dev/null || echo "Контейнеры не запущены"
        ;;
    update)
        echo "📦 Обновление Node..."
        docker compose down
        git pull
        docker compose up -d --build
        echo "✅ Обновлено"
        ;;
    rebuild)
        echo "🔨 Пересборка Node..."
        docker compose down
        docker compose build --no-cache
        docker compose up -d
        echo "✅ Пересобрано"
        ;;
    setup)
        echo ""
        echo "════════════════════════════════════════════════════"
        echo "  Добавление API TOKEN от бота"
        echo "════════════════════════════════════════════════════"
        echo ""
        
        read -p "Введите API TOKEN от бота: " API_TOKEN
        
        if [ -z "$API_TOKEN" ]; then
            echo "❌ API TOKEN не может быть пустым!"
            exit 1
        fi
        
        if grep -q "^API_TOKEN=" node-agent/.env 2>/dev/null; then
            sed -i "s/^API_TOKEN=.*/API_TOKEN=$API_TOKEN/" node-agent/.env
            echo "✅ API TOKEN обновлён"
        else
            echo "API_TOKEN=$API_TOKEN" >> node-agent/.env
            echo "✅ API TOKEN добавлен"
        fi
        
        echo ""
        echo "🔄 Перезапуск node-agent..."
        docker compose restart node-agent
        
        echo ""
        echo "✅ Готово! Проверьте подключение:"
        echo "   mtproxy-node logs node-agent"
        ;;
    config)
        if [ -f "node-agent/.env" ]; then
            echo "📄 Конфигурация Node:"
            cat node-agent/.env | grep -v "^#" | grep -v "^$"
        else
            echo "❌ Файл конфигурации не найден"
        fi
        ;;
    shell)
        if [ -n "$2" ]; then
            docker compose exec "$2" sh
        else
            docker compose exec node-agent sh
        fi
        ;;
    proxy-link)
        echo "🔗 MTProxy ссылка:"
        docker logs mtproxy 2>&1 | grep -E "tg://|t.me/proxy" | head -1
        ;;
    *)
        echo "MTProxy Node - Управление"
        echo ""
        echo "Использование: mtproxy-node <команда> [опции]"
        echo ""
        echo "Команды:"
        echo "  start       - Запустить Node"
        echo "  stop        - Остановить Node"
        echo "  restart     - Перезапустить Node"
        echo "  logs [сервис] - Показать логи (Ctrl+C для выхода)"
        echo "  status      - Показать статус и ресурсы"
        echo "  update      - Обновить из GitHub и перезапустить"
        echo "  rebuild     - Пересобрать с нуля"
        echo "  setup       - Добавить/обновить API TOKEN от бота"
        echo "  config      - Показать текущую конфигурацию"
        echo "  shell [сервис] - Открыть shell в контейнере"
        echo "  proxy-link  - Показать MTProxy ссылку"
        echo ""
        echo "Примеры:"
        echo "  mtproxy-node status"
        echo "  mtproxy-node logs node-agent"
        echo "  mtproxy-node setup"
        echo "  mtproxy-node proxy-link"
        ;;
esac
NODE_SCRIPT_EOF

chmod +x /usr/local/bin/mtproxy-node

echo "✅ Команда 'mtproxy-node' создана"

echo ""
echo "════════════════════════════════════════════════════"
echo "  ✅ MTProxy Node установлен!"
echo "════════════════════════════════════════════════════"
echo ""
echo "📋 ШАГ 1: Добавьте ноду в Control Panel через бота"
echo ""
echo "В Telegram боте отправьте команду /add_node"
echo "Затем отправьте эти данные:"
echo ""
echo "─────────────────────────────────────────────────────"
echo "name: $NODE_NAME"
echo "domain: $DOMAIN"
echo "ip: $EXTERNAL_IP"
echo "api_url: http://$EXTERNAL_IP:3001"
echo "mtproto_port: 443"
echo "socks5_port: 1080"
echo "workers: $WORKERS"
echo "cpu_cores: $CPU_CORES"
echo "ram_mb: $RAM_MB"
echo "─────────────────────────────────────────────────────"
echo ""
echo "🔑 Сохраните API Key: $API_KEY"
echo "   (может понадобиться для прямых запросов к API)"
echo ""
echo "📋 ШАГ 2: После добавления ноды бот выдаст API TOKEN"
echo ""
echo "Выполните команду для добавления токена:"
echo ""
echo "   mtproxy-node setup"
echo ""
echo "🔗 MTProxy ссылка (для проверки):"
if [ -n "$SECRET_LINE" ]; then
    echo "   $SECRET_LINE"
else
    echo "   mtproxy-node proxy-link"
fi
echo ""
echo "� Управление из любой директории:"
echo "   mtproxy-node status      - статус и ресурсы"
echo "   mtproxy-node logs        - просмотр всех логов"
echo "   mtproxy-node logs node-agent  - логи агента"
echo "   mtproxy-node restart     - перезапуск"
echo "   mtproxy-node setup       - добавить API TOKEN"
echo "   mtproxy-node config      - показать конфигурацию"
echo "   mtproxy-node update      - обновление"
echo ""
echo "📂 Директория установки: $INSTALL_DIR"
echo ""
echo "════════════════════════════════════════════════════"
echo ""
