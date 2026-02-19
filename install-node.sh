#!/usr/bin/env bash
set -euo pipefail

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✅${NC} $1"; }
warning() { echo -e "${YELLOW}⚠️${NC} $1"; }
error() { echo -e "${RED}❌${NC} $1"; exit 1; }

# Функция для экранирования специальных символов в sed replacement части
# Для sed с разделителем | нужно экранировать: | & \
escape_sed() {
    # Экранируем обратный слэш первым (чтобы не экранировать уже экранированные символы)
    # Затем экранируем разделитель | и амперсанд &
    echo "$1" | sed 's/\\/\\\\/g' | sed 's/|/\\|/g' | sed 's/&/\\&/g'
}

echo ""
echo "═══════════════════════════════════════"
echo "  MTProxy Node Agent — установка"
echo "═══════════════════════════════════════"
echo ""

# ═══════════════════════════════════════════════════════════════
# Проверка окружения и зависимостей
# ═══════════════════════════════════════════════════════════════

info "Проверка окружения..."

# Проверка ОС
if [ -f /etc/os-release ]; then
    . /etc/os-release
    success "ОС: $PRETTY_NAME"
else
    warning "Не удалось определить ОС"
fi

# Проверка прав root (не нужны, но предупреждаем)
if [ "$EUID" -eq 0 ]; then
    warning "Не рекомендуется запускать скрипт от root. Используйте обычного пользователя с sudo."
fi

# Проверка Docker
if ! command -v docker &>/dev/null; then
    error "Docker не найден. Установите Docker: https://docs.docker.com/engine/install/"
fi

if ! docker compose version &>/dev/null; then
    error "Docker Compose не найден. Установите Docker Compose plugin."
fi

success "Docker: $(docker --version | cut -d' ' -f3 | cut -d',' -f1)"
success "Docker Compose: $(docker compose version | cut -d' ' -f4)"

# Проверка прав на Docker
if ! docker ps &> /dev/null; then
    warning "Нет прав на выполнение Docker команд"
    info "Добавление пользователя $USER в группу docker..."
    sudo usermod -aG docker "$USER" || true
    warning "Пользователь добавлен в группу docker"
    warning "Выйдите и войдите снова, или выполните: newgrp docker"
    warning "Затем запустите скрипт снова"
    exit 1
fi

# Проверка портов
info "Проверка портов..."
check_port() {
    if command -v netstat &>/dev/null; then
        netstat -tuln | grep -q ":$1 " && return 0 || return 1
    elif command -v ss &>/dev/null; then
        ss -tuln | grep -q ":$1 " && return 0 || return 1
    else
        return 1
    fi
}

if check_port 8080; then
    warning "Порт 8080 уже занят (Node Agent API)"
fi

if check_port 443; then
    warning "Порт 443 уже занят (MTProto). Убедитесь, что это правильный порт."
fi

if check_port 1080; then
    warning "Порт 1080 уже занят (SOCKS5). Убедитесь, что это правильный порт."
fi

# Проверка свободного места на диске
info "Проверка свободного места..."
AVAILABLE_SPACE=$(df -BG . | tail -1 | awk '{print $4}' | sed 's/G//')
if [ "$AVAILABLE_SPACE" -lt 3 ]; then
    warning "Мало свободного места на диске: ${AVAILABLE_SPACE}GB (рекомендуется минимум 3GB)"
else
    success "Свободное место: ${AVAILABLE_SPACE}GB"
fi

# Проверка памяти
if [ -f /proc/meminfo ]; then
    AVAILABLE_MEM=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
    AVAILABLE_MEM_GB=$((AVAILABLE_MEM / 1024 / 1024))
    if [ "$AVAILABLE_MEM_GB" -lt 1 ]; then
        warning "Мало доступной памяти: ${AVAILABLE_MEM_GB}GB (рекомендуется минимум 1GB)"
    else
        success "Доступная память: ${AVAILABLE_MEM_GB}GB"
    fi
fi

echo ""

# ═══════════════════════════════════════════════════════════════
# Настройка переменных окружения
# ═══════════════════════════════════════════════════════════════

if [ ! -f .env ]; then
    info "Создание .env из ENV.example..."
    if [ ! -f ENV.example ]; then
        error "Файл ENV.example не найден. Убедитесь, что вы находитесь в корне проекта."
    fi
    cp ENV.example .env
    success ".env создан"
    echo ""
    echo "═══════════════════════════════════════"
    echo "  Настройка переменных окружения"
    echo "═══════════════════════════════════════"
    echo ""
    echo "Заполните обязательные переменные:"
    echo ""
    echo "  API_TOKEN          — секретный токен для доступа к API ноды"
    echo "  DOMAIN             — домен ноды (например, proxy.example.com)"
    echo "  INTERNAL_IP        — внутренний IP сервера"
    echo "  MTPROTO_PORT       — порт MTProto (обычно 443)"
    echo ""
    echo "Опционально:"
    echo "  MT_PROXY_IMAGE     — образ MTProxy (по умолчанию telegrammessenger/proxy:latest)"
    echo "  WORKERS            — количество воркеров (по умолчанию 2)"
    echo "  ENABLE_SOCKS5      — включить SOCKS5 (false/true)"
    echo ""
    
    # Интерактивный ввод основных переменных
    read -p "Ввести переменные интерактивно? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "API_TOKEN: " API_TOKEN
        read -p "DOMAIN: " DOMAIN
        read -p "INTERNAL_IP: " INTERNAL_IP
        read -p "MTPROTO_PORT [443]: " MTPROTO_PORT
        MTPROTO_PORT=${MTPROTO_PORT:-443}
        
        # Обновляем .env (экранируем специальные символы для безопасности)
        API_TOKEN_ESC=$(escape_sed "$API_TOKEN")
        DOMAIN_ESC=$(escape_sed "$DOMAIN")
        INTERNAL_IP_ESC=$(escape_sed "$INTERNAL_IP")
        MTPROTO_PORT_ESC=$(escape_sed "$MTPROTO_PORT")
        
        sed -i "s|^API_TOKEN=.*|API_TOKEN=$API_TOKEN_ESC|" .env
        sed -i "s|^DOMAIN=.*|DOMAIN=$DOMAIN_ESC|" .env
        sed -i "s|^INTERNAL_IP=.*|INTERNAL_IP=$INTERNAL_IP_ESC|" .env
        sed -i "s|^MTPROTO_PORT=.*|MTPROTO_PORT=$MTPROTO_PORT_ESC|" .env
        
        success "Основные переменные сохранены"
        info "Остальные переменные можно настроить позже в файле .env"
    else
        read -p "Открыть .env для редактирования? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            ${EDITOR:-nano} .env
        else
            info "Отредактируйте .env вручную: nano .env"
            info "Затем запустите скрипт снова: ./install-node.sh"
            exit 0
        fi
    fi
fi

# Проверка обязательных переменных
info "Проверка переменных окружения..."
source .env 2>/dev/null || true

MISSING_VARS=()

if [ -z "${API_TOKEN:-}" ] || [ "$API_TOKEN" = "" ] || [ "$API_TOKEN" = "change-me" ]; then
    MISSING_VARS+=("API_TOKEN")
fi

if [ -z "${DOMAIN:-}" ] || [ "$DOMAIN" = "" ] || [ "$DOMAIN" = "example.com" ]; then
    MISSING_VARS+=("DOMAIN")
fi

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    warning "Не заполнены обязательные переменные: ${MISSING_VARS[*]}"
    read -p "Открыть .env для редактирования? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ${EDITOR:-nano} .env
        info "Запустите скрипт снова: ./install-node.sh"
        exit 0
    else
        error "Заполните .env и запустите снова."
    fi
fi

success "Все обязательные переменные заполнены"

# ═══════════════════════════════════════════════════════════════
# Подготовка директорий и файлов
# ═══════════════════════════════════════════════════════════════

info "Создание необходимых директорий..."
mkdir -p node-data
success "Директории созданы"

# Проверка наличия скриптов управления
if [ ! -f scripts/manage-node.sh ]; then
    error "Скрипт scripts/manage-node.sh не найден"
fi
chmod +x scripts/manage-node.sh

# Проверка docker-compose.node.yml
if [ ! -f docker-compose.node.yml ]; then
    error "Файл docker-compose.node.yml не найден"
fi

# Проверка Dockerfile
if [ ! -f node-agent/Dockerfile ]; then
    error "Файл node-agent/Dockerfile не найден"
fi

success "Все необходимые файлы найдены"

# ═══════════════════════════════════════════════════════════════
# Запуск Node Agent
# ═══════════════════════════════════════════════════════════════

echo ""
info "Запуск Node Agent..."
./scripts/manage-node.sh start

echo ""
echo "═══════════════════════════════════════"
success "Node Agent установлен!"
echo "═══════════════════════════════════════"
echo ""
echo "📋 Полезные команды:"
echo ""
echo "Управление:"
echo "  ./scripts/manage-node.sh start   — запустить"
echo "  ./scripts/manage-node.sh stop    — остановить"
echo "  ./scripts/manage-node.sh restart — перезапустить"
echo "  ./scripts/manage-node.sh logs    — логи"
echo "  ./scripts/manage-node.sh status  — статус"
echo ""
echo "Обновление:"
echo "  ./update-node.sh                 — обновить и перезапустить"
echo ""
echo "Проверка:"
echo "  docker logs mtproxy-node-agent   — логи контейнера"
echo ""
echo "Следующий шаг:"
echo "  Добавьте эту ноду в Control Panel через бота: /add_node"
NODE_IP=$(hostname -I | awk '{print $1}' || echo "YOUR_SERVER_IP")
echo "  API URL: http://${NODE_IP}:8080"
echo "  API Token: ${API_TOKEN}"
echo ""
