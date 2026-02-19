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
echo "  MTProxy Control Panel — установка"
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

# Функция установки Docker
install_docker() {
    info "Установка Docker..."
    
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$ID
    else
        error "Не удалось определить ОС"
    fi
    
    case $OS in
        ubuntu|debian)
            info "Обновление пакетов..."
            sudo apt-get update -qq
            
            info "Установка зависимостей..."
            sudo apt-get install -y -qq \
                ca-certificates \
                curl \
                gnupg \
                lsb-release
            
            info "Добавление GPG ключа Docker..."
            sudo install -m 0755 -d /etc/apt/keyrings
            curl -fsSL https://download.docker.com/linux/$OS/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
            sudo chmod a+r /etc/apt/keyrings/docker.gpg
            
            info "Добавление репозитория Docker..."
            echo \
              "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS \
              $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
            
            info "Установка Docker и Docker Compose..."
            sudo apt-get update -qq
            sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            
            # Запуск и включение Docker сервиса
            info "Запуск Docker сервиса..."
            sudo systemctl enable docker
            sudo systemctl start docker
            
            # Ждем запуска Docker
            sleep 2
            
            # Проверяем статус
            if sudo systemctl is-active --quiet docker; then
                success "Docker установлен и запущен"
            else
                warning "Docker установлен, но сервис не запущен. Попробуйте: sudo systemctl start docker"
            fi
            ;;
        *)
            error "Автоматическая установка Docker для $OS не поддерживается. Установите вручную: https://docs.docker.com/engine/install/"
            ;;
    esac
}

# Проверка и установка Docker
if ! command -v docker &>/dev/null; then
    warning "Docker не найден"
    read -p "Установить Docker автоматически? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        install_docker
    else
        error "Установите Docker: https://docs.docker.com/engine/install/"
    fi
fi

# Проверка Docker Compose
if ! docker compose version &>/dev/null; then
    warning "Docker Compose не найден"
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        if [ "$ID" = "ubuntu" ] || [ "$ID" = "debian" ]; then
            read -p "Установить Docker Compose автоматически? [Y/n] " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                info "Установка Docker Compose plugin..."
                sudo apt-get update -qq
                sudo apt-get install -y -qq docker-compose-plugin
                success "Docker Compose установлен"
            else
                error "Установите Docker Compose plugin: https://docs.docker.com/compose/install/"
            fi
        else
            error "Установите Docker Compose plugin: https://docs.docker.com/compose/install/"
        fi
    else
        error "Установите Docker Compose plugin: https://docs.docker.com/compose/install/"
    fi
fi

success "Docker: $(docker --version | cut -d' ' -f3 | cut -d',' -f1)"
success "Docker Compose: $(docker compose version | cut -d' ' -f4)"

# Проверка прав на Docker
if ! docker ps &> /dev/null; then
    warning "Нет прав на выполнение Docker команд"
    info "Добавление пользователя $USER в группу docker..."
    sudo usermod -aG docker "$USER" || true
    success "Пользователь добавлен в группу docker"
    
    # Пытаемся активировать группу без перелогина
    if command -v newgrp &>/dev/null; then
        info "Активация группы docker..."
        newgrp docker <<EOF
docker ps &> /dev/null && echo "Группа docker активирована" || echo "Требуется перелогин"
EOF
    fi
    
    warning "Если Docker команды не работают, выполните: newgrp docker"
    warning "Или выйдите и войдите снова, затем запустите скрипт снова"
    
    # Проверяем еще раз после добавления в группу
    if ! docker ps &> /dev/null 2>&1; then
        warning "Docker команды все еще не работают. Попробуйте выполнить: newgrp docker"
        read -p "Продолжить установку? (Docker команды могут не работать) [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
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

if check_port 8081; then
    warning "Порт 8081 уже занят (REMNAWAVE_API_PORT)"
fi

if check_port 8082; then
    warning "Порт 8082 уже занят (WEB_API_PORT)"
fi

if check_port 6379; then
    warning "Порт 6379 уже занят (Redis). Убедитесь, что Redis не запущен отдельно."
fi

# Проверка свободного места на диске
info "Проверка свободного места..."
AVAILABLE_SPACE=$(df -BG . | tail -1 | awk '{print $4}' | sed 's/G//')
if [ "$AVAILABLE_SPACE" -lt 5 ]; then
    warning "Мало свободного места на диске: ${AVAILABLE_SPACE}GB (рекомендуется минимум 5GB)"
else
    success "Свободное место: ${AVAILABLE_SPACE}GB"
fi

# Проверка памяти
if [ -f /proc/meminfo ]; then
    AVAILABLE_MEM=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
    AVAILABLE_MEM_GB=$((AVAILABLE_MEM / 1024 / 1024))
    if [ "$AVAILABLE_MEM_GB" -lt 2 ]; then
        warning "Мало доступной памяти: ${AVAILABLE_MEM_GB}GB (рекомендуется минимум 2GB)"
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
    echo "  BOT_TOKEN          — токен бота от @BotFather"
    echo "  ADMIN_IDS          — ваш Telegram ID (через запятую для нескольких)"
    echo "  REMNAWAVE_API_KEY  — секретный ключ для Remnawave API"
    echo "  REMNAWAVE_BASE_URL — домен панели Remnawave (например: https://panel.example.com)"
    echo "  REMNAWAVE_TOKEN    — токен для Remnawave API (если используете прямой доступ)"
    echo "  WEB_API_KEY        — секретный ключ для Web API"
    echo ""
    echo "Опционально (для интеграции с веб-приложением):"
    echo "  BACKEND_BASE_URL   — URL вашего backend (api-1.yaml), если используете"
    echo "  BACKEND_TOKEN      — токен для backend API, если используете"
    echo ""
    echo "Redis (обязательно для продакшена):"
    echo "  REDIS_HOST         — хост Redis (по умолчанию redis)"
    echo "  REDIS_PORT         — порт Redis (по умолчанию 6379)"
    echo ""
    echo "Опционально (для продаж):"
    echo "  YOOMONEY_TOKEN     — токен API YooMoney"
    echo "  YOOMONEY_WALLET    — номер кошелька YooMoney"
    echo ""
    
    # Интерактивный ввод основных переменных
    read -p "Ввести переменные интерактивно? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "BOT_TOKEN: " BOT_TOKEN
        read -p "ADMIN_IDS (через запятую): " ADMIN_IDS
        read -p "REMNAWAVE_API_KEY: " REMNAWAVE_API_KEY
        read -p "REMNAWAVE_BASE_URL (домен панели, например: https://panel.example.com): " REMNAWAVE_BASE_URL
        read -p "REMNAWAVE_TOKEN (оставьте пустым если не используете прямой доступ к Remnawave): " REMNAWAVE_TOKEN
        read -p "WEB_API_KEY: " WEB_API_KEY
        echo ""
        echo "Опционально (для интеграции с веб-приложением):"
        read -p "BACKEND_BASE_URL (оставьте пустым если не используете): " BACKEND_BASE_URL
        read -p "BACKEND_TOKEN (оставьте пустым если не используете): " BACKEND_TOKEN
        
        # Обновляем .env (экранируем специальные символы для безопасности)
        BOT_TOKEN_ESC=$(escape_sed "$BOT_TOKEN")
        ADMIN_IDS_ESC=$(escape_sed "$ADMIN_IDS")
        REMNAWAVE_API_KEY_ESC=$(escape_sed "$REMNAWAVE_API_KEY")
        REMNAWAVE_BASE_URL_ESC=$(escape_sed "$REMNAWAVE_BASE_URL")
        REMNAWAVE_TOKEN_ESC=$(escape_sed "$REMNAWAVE_TOKEN")
        WEB_API_KEY_ESC=$(escape_sed "$WEB_API_KEY")
        
        sed -i "s|^BOT_TOKEN=.*|BOT_TOKEN=$BOT_TOKEN_ESC|" .env
        sed -i "s|^ADMIN_IDS=.*|ADMIN_IDS=$ADMIN_IDS_ESC|" .env
        sed -i "s|^REMNAWAVE_API_KEY=.*|REMNAWAVE_API_KEY=$REMNAWAVE_API_KEY_ESC|" .env
        sed -i "s|^REMNAWAVE_BASE_URL=.*|REMNAWAVE_BASE_URL=$REMNAWAVE_BASE_URL_ESC|" .env
        sed -i "s|^REMNAWAVE_TOKEN=.*|REMNAWAVE_TOKEN=$REMNAWAVE_TOKEN_ESC|" .env
        sed -i "s|^WEB_API_KEY=.*|WEB_API_KEY=$WEB_API_KEY_ESC|" .env
        
        # Обновляем опциональные переменные только если они заполнены
        if [ -n "$BACKEND_BASE_URL" ]; then
            BACKEND_BASE_URL_ESC=$(escape_sed "$BACKEND_BASE_URL")
            sed -i "s|^BACKEND_BASE_URL=.*|BACKEND_BASE_URL=$BACKEND_BASE_URL_ESC|" .env
        fi
        
        if [ -n "$BACKEND_TOKEN" ]; then
            BACKEND_TOKEN_ESC=$(escape_sed "$BACKEND_TOKEN")
            sed -i "s|^BACKEND_TOKEN=.*|BACKEND_TOKEN=$BACKEND_TOKEN_ESC|" .env
        fi
        
        success "Основные переменные сохранены"
        info "Остальные переменные можно настроить позже в файле .env"
    else
        read -p "Открыть .env для редактирования? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            ${EDITOR:-nano} .env
        else
            info "Отредактируйте .env вручную: nano .env"
            info "Затем запустите скрипт снова: ./install-control.sh"
            exit 0
        fi
    fi
fi

# Проверка обязательных переменных
info "Проверка переменных окружения..."
source .env 2>/dev/null || true

MISSING_VARS=()

if [ -z "${BOT_TOKEN:-}" ] || [ "$BOT_TOKEN" = "" ]; then
    MISSING_VARS+=("BOT_TOKEN")
fi

if [ -z "${ADMIN_IDS:-}" ] || [ "$ADMIN_IDS" = "" ]; then
    MISSING_VARS+=("ADMIN_IDS")
fi

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    warning "Не заполнены обязательные переменные: ${MISSING_VARS[*]}"
    read -p "Открыть .env для редактирования? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        ${EDITOR:-nano} .env
        info "Запустите скрипт снова: ./install-control.sh"
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
mkdir -p data certs data/logs
success "Директории созданы"

# Проверка наличия скриптов управления
if [ ! -f scripts/manage-control.sh ]; then
    error "Скрипт scripts/manage-control.sh не найден"
fi
chmod +x scripts/manage-control.sh

# Проверка docker-compose.yml
if [ ! -f docker-compose.yml ]; then
    error "Файл docker-compose.yml не найден"
fi

# Проверка Dockerfile
if [ ! -f control-panel/Dockerfile ]; then
    error "Файл control-panel/Dockerfile не найден"
fi

success "Все необходимые файлы найдены"

# ═══════════════════════════════════════════════════════════════
# Информация о Redis
# ═══════════════════════════════════════════════════════════════

info "Redis будет запущен автоматически через docker-compose"
info "Redis обязателен для продакшена с тысячами пользователей"

# ═══════════════════════════════════════════════════════════════
# Запуск Control Panel
# ═══════════════════════════════════════════════════════════════

echo ""
info "Запуск Control Panel..."
./scripts/manage-control.sh start

echo ""
echo "═══════════════════════════════════════"
success "Control Panel установлен!"
echo "═══════════════════════════════════════"
echo ""
echo "📋 Полезные команды:"
echo ""
echo "Управление:"
echo "  ./scripts/manage-control.sh start   — запустить"
echo "  ./scripts/manage-control.sh stop    — остановить"
echo "  ./scripts/manage-control.sh restart — перезапустить"
echo "  ./scripts/manage-control.sh logs    — логи"
echo "  ./scripts/manage-control.sh status  — статус"
echo ""
echo "Обновление:"
echo "  ./update.sh                         — обновить и перезапустить"
echo ""
echo "Проверка:"
echo "  docker logs mtproxy-control         — логи контейнера"
echo "  docker logs mtproxy-redis           — логи Redis"
echo "  tail -f data/logs/app-*.log         — файловые логи"
echo ""
echo "Следующие шаги:"
echo "  1. Проверьте статус: ./scripts/manage-control.sh status"
echo "  2. Проверьте логи: ./scripts/manage-control.sh logs"
echo "  3. Добавьте ноды через Telegram бота"
echo ""
