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

# Директория установки
INSTALL_DIR="/opt/mtproxy-node"

# Проверка на существующую установку
if [ -d "$INSTALL_DIR" ]; then
    echo "📦 Обнаружена существующая установка"
    echo ""
    echo "Выберите действие:"
    echo "1) Обновить (git pull + перезапуск)"
    echo "2) Показать API KEY"
    echo "3) Переустановить (удалить всё и установить заново)"
    echo "4) Выход"
    echo ""
    read -p "Ваш выбор (1-4): " choice
    
    case $choice in
        1)
            echo ""
            echo "🔄 Обновление..."
            cd "$INSTALL_DIR"
            git pull
            docker compose down
            docker compose up -d --build
            
            # Показываем API KEY
            if [ -f "node-agent/.env" ]; then
                API_KEY=$(grep "^API_KEY=" node-agent/.env | cut -d '=' -f2)
                if [ -n "$API_KEY" ]; then
                    IP=$(curl -s ifconfig.me)
                    echo ""
                    echo "✅ Обновление завершено!"
                    echo ""
                    echo "📋 Данные для добавления в бот:"
                    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                    echo "name: Node-1"
                    echo "ip: $IP"
                    echo "api_key: $API_KEY"
                    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                fi
            fi
            exit 0
            ;;
        2)
            echo ""
            if [ -f "$INSTALL_DIR/node-agent/.env" ]; then
                API_KEY=$(grep "^API_TOKEN=" "$INSTALL_DIR/node-agent/.env" | cut -d '=' -f2)
                IP=$(curl -s ifconfig.me)
                if [ -n "$API_KEY" ]; then
                    echo "📋 Данные для добавления в бот:"
                    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                    echo "name: Node-1"
                    echo "ip: $IP"
                    echo "api_key: $API_KEY"
                    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                else
                    echo "❌ API_TOKEN не найден в .env файле"
                fi
            else
                echo "❌ Файл .env не найден"
            fi
            exit 0
            ;;
        3)
            echo ""
            echo "⚠️  ВНИМАНИЕ! Все данные будут удалены!"
            read -p "Продолжить? (yes/no): " confirm
            if [ "$confirm" != "yes" ]; then
                echo "Отменено"
                exit 0
            fi
            cd "$INSTALL_DIR"
            docker compose down -v
            cd /
            rm -rf "$INSTALL_DIR"
            echo "✅ Старая установка удалена"
            ;;
        4)
            echo "Выход"
            exit 0
            ;;
        *)
            echo "❌ Неверный выбор"
            exit 1
            ;;
    esac
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
echo "📥 Загрузка node-agent..."
mkdir -p "$INSTALL_DIR/node-agent"
cd "$INSTALL_DIR"

# Скачиваем только нужные файлы node-agent из GitHub
REPO_URL="https://raw.githubusercontent.com/goodboy34-tech/eeee/master/node-agent"
FILES=(
    "package.json"
    "package-lock.json"
    "tsconfig.json"
    "Dockerfile"
    ".env.example"
)

echo "Загрузка файлов node-agent..."
for file in "${FILES[@]}"; do
    echo "  📄 $file"
    curl -fsSL "$REPO_URL/$file" -o "node-agent/$file"
done

# Загружаем src директорию
echo "  📁 src/"
mkdir -p node-agent/src
curl -fsSL "$REPO_URL/src/api.ts" -o "node-agent/src/api.ts"

echo "✅ node-agent загружен"

echo ""
echo "════════════════════════════════════════════════════"
echo "  Настройка ноды"
echo "════════════════════════════════════════════════════"
echo ""

# Генерация API ключа для авторизации
echo "Генерация API ключа..."
API_KEY=$(openssl rand -hex 32)
echo "🔑 API Key: $API_KEY"

echo ""
echo "📝 Создание конфигурации node-agent..."

# Минимальная конфигурация - всё остальное настраивается через API
cat > node-agent/.env <<EOF
# API Configuration
API_TOKEN=$API_KEY
API_PORT=3000

# Node Environment
NODE_ENV=production
EOF

echo "✅ Конфигурация создана: node-agent/.env"

# Создание .env в корне для docker-compose
echo ""
echo "📝 Создание .env для docker-compose..."

cat > .env <<EOF
# API Configuration
API_TOKEN=$API_KEY
API_PORT=3000
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
    ports:
      - "${API_PORT:-3000}:3000"
    networks:
      - mtproxy-network

networks:
  mtproxy-network:
    driver: bridge
COMPOSE_EOF

echo "✅ docker-compose.yml создан"

# Настройка firewall
echo ""
read -p "Настроить firewall автоматически? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🔥 Настройка firewall..."
    if command -v ufw &>/dev/null; then
        ufw allow 443/tcp comment "MTProxy"
        ufw allow 1080/tcp comment "SOCKS5"
        ufw allow 3000/tcp comment "Node API"
        echo "✅ Правила UFW добавлены"
    elif command -v firewall-cmd &>/dev/null; then
        firewall-cmd --permanent --add-port=443/tcp
        firewall-cmd --permanent --add-port=1080/tcp
        firewall-cmd --permanent --add-port=3000/tcp
        firewall-cmd --reload
        echo "✅ Правила FirewallD добавлены"
    else
        echo "⚠️  Firewall не обнаружен, настройте вручную:"
        echo "   Порты: 443, 1080, 3000"
    fi
else
    echo "⚠️  Не забудьте открыть порты вручную:"
    echo "   443/tcp  - MTProxy"
    echo "   1080/tcp - SOCKS5"
    echo "   3000/tcp - Node API"
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
echo "📂 Директория: $INSTALL_DIR"
echo ""
echo "════════════════════════════════════════════════════"
