#!/bin/bash
set -e

echo "════════════════════════════════════════════════════"
echo "  MTProxy Control Panel - Установка"
echo "════════════════════════════════════════════════════"
echo ""

# Проверка root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Запустите скрипт с правами root:"
    echo "   sudo bash install-control.sh"
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

# Клонирование репозитория
INSTALL_DIR="/opt/mtproxy-control"
if [ -d "$INSTALL_DIR" ]; then
    echo ""
    echo "⚠️  Директория $INSTALL_DIR уже существует"
    read -p "Переустановить? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cd "$INSTALL_DIR"
        docker compose down 2>/dev/null || true
        cd /
        rm -rf "$INSTALL_DIR"
    else
        cd "$INSTALL_DIR"
        git pull
        echo ""
        echo "✅ Репозиторий обновлён"
        exit 0
    fi
fi

echo ""
echo "📥 Клонирование репозитория..."
git clone https://github.com/goodboy34-tech/eeee.git "$INSTALL_DIR"
cd "$INSTALL_DIR"

echo ""
echo "════════════════════════════════════════════════════"
echo "  Настройка Control Panel"
echo "════════════════════════════════════════════════════"
echo ""

# Запрос Telegram Bot Token
read -p "Введите Telegram Bot Token: " BOT_TOKEN
if [ -z "$BOT_TOKEN" ]; then
    echo "❌ Bot Token не может быть пустым!"
    exit 1
fi

# Создание .env для control-panel
echo ""
echo "📝 Создание конфигурации..."

cat > control-panel/.env <<EOF
# Telegram Bot Configuration
BOT_TOKEN=$BOT_TOKEN

# Database
DATABASE_PATH=./data/database.sqlite

# Server
PORT=3000
NODE_ENV=production
EOF

echo "✅ Конфигурация создана: control-panel/.env"

# Настройка firewall (опционально)
echo ""
read -p "Настроить firewall для порта 3000? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if command -v ufw &>/dev/null; then
        ufw allow 3000/tcp comment "MTProxy Control Panel"
        echo "✅ Правило UFW добавлено"
    elif command -v firewall-cmd &>/dev/null; then
        firewall-cmd --permanent --add-port=3000/tcp
        firewall-cmd --reload
        echo "✅ Правило FirewallD добавлено"
    else
        echo "⚠️  Firewall не обнаружен"
    fi
fi

# Запуск Control Panel
echo ""
echo "🚀 Запуск Control Panel..."
docker compose up -d --build

echo ""
echo "⏳ Ожидание запуска..."
sleep 10

# Проверка статуса
echo ""
echo "📊 Статус:"
docker compose ps

# Создание глобальной команды управления
echo ""
echo "🔧 Создание глобальной команды 'mtproxy-control'..."

cat > /usr/local/bin/mtproxy-control <<'SCRIPT_EOF'
#!/bin/bash

INSTALL_DIR="/opt/mtproxy-control"

if [ ! -d "$INSTALL_DIR" ]; then
    echo "❌ Control Panel не установлен в $INSTALL_DIR"
    exit 1
fi

cd "$INSTALL_DIR"

case "$1" in
    start)
        echo "🚀 Запуск Control Panel..."
        docker compose up -d
        ;;
    stop)
        echo "🛑 Остановка Control Panel..."
        docker compose down
        ;;
    restart)
        echo "🔄 Перезапуск Control Panel..."
        docker compose restart
        ;;
    logs)
        docker compose logs -f
        ;;
    status)
        echo "📊 Статус Control Panel:"
        docker compose ps
        echo ""
        echo "📈 Использование ресурсов:"
        docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" \
          $(docker compose ps -q) 2>/dev/null || echo "Контейнеры не запущены"
        ;;
    update)
        echo "📦 Обновление Control Panel..."
        docker compose down
        git pull
        docker compose up -d --build
        echo "✅ Обновлено"
        ;;
    rebuild)
        echo "🔨 Пересборка Control Panel..."
        docker compose down
        docker compose build --no-cache
        docker compose up -d
        echo "✅ Пересобрано"
        ;;
    shell)
        docker compose exec control-panel sh
        ;;
    *)
        echo "MTProxy Control Panel - Управление"
        echo ""
        echo "Использование: mtproxy-control <команда>"
        echo ""
        echo "Команды:"
        echo "  start    - Запустить Control Panel"
        echo "  stop     - Остановить Control Panel"
        echo "  restart  - Перезапустить Control Panel"
        echo "  logs     - Показать логи (Ctrl+C для выхода)"
        echo "  status   - Показать статус и ресурсы"
        echo "  update   - Обновить из GitHub и перезапустить"
        echo "  rebuild  - Пересобрать с нуля"
        echo "  shell    - Открыть shell в контейнере"
        echo ""
        echo "Примеры:"
        echo "  mtproxy-control status"
        echo "  mtproxy-control logs"
        echo "  mtproxy-control restart"
        ;;
esac
SCRIPT_EOF

chmod +x /usr/local/bin/mtproxy-control

echo "✅ Команда создана"

echo ""
echo "════════════════════════════════════════════════════"
echo "  ✅ Control Panel установлен!"
echo "════════════════════════════════════════════════════"
echo ""
echo "🤖 Telegram Bot запущен"
echo ""
echo "📋 Управление из любой директории:"
echo "   mtproxy-control status   - статус и ресурсы"
echo "   mtproxy-control logs     - просмотр логов"
echo "   mtproxy-control restart  - перезапуск"
echo "   mtproxy-control update   - обновление"
echo "   mtproxy-control stop     - остановка"
echo ""
echo "📂 Директория установки: $INSTALL_DIR"
echo ""
echo "════════════════════════════════════════════════════"
echo ""
