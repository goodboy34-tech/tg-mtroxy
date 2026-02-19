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
# Скрипт использует sudo только для установки Docker и добавления пользователя в группу docker
if [ "$EUID" -eq 0 ]; then
    warning "Не рекомендуется запускать скрипт от root. Используйте обычного пользователя - скрипт сам запросит sudo при необходимости."
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
    echo "  WEB_API_KEY        — секретный ключ для Web API"
    echo ""
    echo "Опционально (для входящих webhook'ов от Remnawave панели):"
    echo "  REMNAWAVE_API_KEY  — секретный ключ для аутентификации входящих запросов"
    echo "                       (нужен только если Remnawave панель отправляет webhook'и на ваш сервер)"
    echo ""
    echo "Опционально (для прямого доступа к Remnawave API вместо backend):"
    echo "  REMNAWAVE_BASE_URL — домен панели Remnawave (например: https://panel.example.com)"
    echo "  REMNAWAVE_TOKEN    — токен для исходящих запросов к Remnawave API"
    echo "                       (система опрашивает панель через cron, этот токен нужен для прямого API)"
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
        read -p "WEB_API_KEY: " WEB_API_KEY
        echo ""
        echo "Домен для автоматического HTTPS (Caddy):"
        read -p "DOMAIN (ваш домен, например: example.com, оставьте пустым если не используете HTTPS): " DOMAIN
        echo ""
        echo "Опционально (для входящих webhook'ов от Remnawave панели):"
        read -p "REMNAWAVE_API_KEY (оставьте пустым если Remnawave не отправляет webhook'и на ваш сервер): " REMNAWAVE_API_KEY
        echo ""
        echo "Опционально (для прямого доступа к Remnawave API вместо backend):"
        read -p "REMNAWAVE_BASE_URL (домен панели, например: https://panel.example.com, оставьте пустым если не используете): " REMNAWAVE_BASE_URL
        read -p "REMNAWAVE_TOKEN (токен для исходящих запросов, оставьте пустым если не используете): " REMNAWAVE_TOKEN
        echo ""
        echo "Опционально (для интеграции с веб-приложением):"
        read -p "BACKEND_BASE_URL (оставьте пустым если не используете): " BACKEND_BASE_URL
        read -p "BACKEND_TOKEN (оставьте пустым если не используете): " BACKEND_TOKEN
        
        # Обновляем .env (экранируем специальные символы для безопасности)
        BOT_TOKEN_ESC=$(escape_sed "$BOT_TOKEN")
        ADMIN_IDS_ESC=$(escape_sed "$ADMIN_IDS")
        WEB_API_KEY_ESC=$(escape_sed "$WEB_API_KEY")
        DOMAIN_ESC=$(escape_sed "$DOMAIN")
        
        sed -i "s|^BOT_TOKEN=.*|BOT_TOKEN=$BOT_TOKEN_ESC|" .env
        sed -i "s|^ADMIN_IDS=.*|ADMIN_IDS=$ADMIN_IDS_ESC|" .env
        sed -i "s|^WEB_API_KEY=.*|WEB_API_KEY=$WEB_API_KEY_ESC|" .env
        
        # Обновляем домен для Caddy (только в секции control-panel, не в node-agent)
        if [ -n "$DOMAIN" ]; then
            # Ищем DOMAIN в секции control-panel (до секции node-agent)
            if grep -q "^# Домен для автоматического HTTPS" .env; then
                # Если есть комментарий, обновляем или добавляем после него
                if grep -A 5 "^# Домен для автоматического HTTPS" .env | grep -q "^DOMAIN="; then
                    # Обновляем существующий DOMAIN в секции control-panel
                    sed -i "/^# Домен для автоматического HTTPS/,/^# node-agent/ s|^DOMAIN=.*|DOMAIN=$DOMAIN_ESC|" .env
                else
                    # Добавляем после комментария
                    sed -i "/^# Домен для автоматического HTTPS/a DOMAIN=$DOMAIN_ESC" .env
                fi
            else
                # Если комментария нет, добавляем перед секцией node-agent или в конец секции control-panel
                if grep -q "^# node-agent" .env; then
                    sed -i "/^# node-agent/i # Домен для автоматического HTTPS через Caddy (обязательно для продакшена)\n# Если указан - Caddy автоматически получит SSL сертификат от Let's Encrypt\n# Пример: DOMAIN=your-domain.com\nDOMAIN=$DOMAIN_ESC\n" .env
                else
                    # Если секции node-agent нет, добавляем в конец
                    echo "" >> .env
                    echo "# Домен для автоматического HTTPS через Caddy (обязательно для продакшена)" >> .env
                    echo "# Если указан - Caddy автоматически получит SSL сертификат от Let's Encrypt" >> .env
                    echo "# Пример: DOMAIN=your-domain.com" >> .env
                    echo "DOMAIN=$DOMAIN_ESC" >> .env
                fi
            fi
            # Обновляем Caddyfile с доменом
            if [ -f Caddyfile ]; then
                # #region agent log
                echo "{\"id\":\"install_update_caddyfile\",\"timestamp\":$(date +%s000),\"location\":\"install-control.sh:324\",\"message\":\"Updating Caddyfile\",\"data\":{\"domain\":\"$DOMAIN\",\"caddyfile_exists\":true},\"runId\":\"install_run\",\"hypothesisId\":\"G\"}" >> "$LOG_FILE"
                # #endregion
                
                # Заменяем домен в Caddyfile (ищем строку с доменом в начале блока)
                sed -i "s|^[a-zA-Z0-9.-]* {|$DOMAIN_ESC {|" Caddyfile
                sed -i "s|^example.com|$DOMAIN_ESC|g" Caddyfile
                
                # #region agent log
                echo "{\"id\":\"install_caddyfile_updated\",\"timestamp\":$(date +%s000),\"location\":\"install-control.sh:330\",\"message\":\"Caddyfile updated\",\"data\":{\"first_line\":\"$(head -n 1 Caddyfile)\"},\"runId\":\"install_run\",\"hypothesisId\":\"G\"}" >> "$LOG_FILE"
                # #endregion
            else
                # #region agent log
                echo "{\"id\":\"install_caddyfile_missing\",\"timestamp\":$(date +%s000),\"location\":\"install-control.sh:333\",\"message\":\"Caddyfile not found\",\"data\":{},\"runId\":\"install_run\",\"hypothesisId\":\"G\"}" >> "$LOG_FILE"
                # #endregion
            fi
        fi
        
        # Функция для безопасного обновления переменной только в секции control-panel
        update_env_var() {
            local var_name="$1"
            local var_value="$2"
            local var_escaped=$(escape_sed "$var_value")
            
            # Проверяем, есть ли секция node-agent
            if grep -q "^# node-agent" .env; then
                # Обновляем только в секции control-panel (до node-agent)
                # Ищем переменную в секции control-panel (не закомментированную)
                if sed -n "/^# control-panel/,/^# node-agent/p" .env | grep -q "^${var_name}="; then
                    # Переменная существует в секции control-panel - обновляем
                    sed -i "/^# control-panel/,/^# node-agent/ s|^${var_name}=.*|${var_name}=${var_escaped}|" .env
                else
                    # Переменной нет - добавляем перед секцией node-agent (после последней переменной control-panel)
                    # Ищем последнюю непустую строку перед node-agent
                    if grep -B 5 "^# node-agent" .env | grep -q "^[A-Z_]*="; then
                        # Есть переменные перед node-agent - добавляем после последней
                        sed -i "/^# node-agent/i ${var_name}=${var_escaped}" .env
                    else
                        # Нет переменных - добавляем после комментария control-panel или перед node-agent
                        sed -i "/^# node-agent/i ${var_name}=${var_escaped}" .env
                    fi
                fi
            else
                # Секции node-agent нет - обновляем первое вхождение или добавляем в конец
                if grep -q "^${var_name}=" .env; then
                    sed -i "0,/^${var_name}=/ s|^${var_name}=.*|${var_name}=${var_escaped}|" .env
                else
                    echo "${var_name}=${var_escaped}" >> .env
                fi
            fi
        }
        
        # Обновляем опциональные переменные только если они заполнены
        if [ -n "$REMNAWAVE_API_KEY" ]; then
            update_env_var "REMNAWAVE_API_KEY" "$REMNAWAVE_API_KEY"
        fi
        
        if [ -n "$REMNAWAVE_BASE_URL" ]; then
            update_env_var "REMNAWAVE_BASE_URL" "$REMNAWAVE_BASE_URL"
        fi
        
        if [ -n "$REMNAWAVE_TOKEN" ]; then
            update_env_var "REMNAWAVE_TOKEN" "$REMNAWAVE_TOKEN"
        fi
        
        if [ -n "$BACKEND_BASE_URL" ]; then
            update_env_var "BACKEND_BASE_URL" "$BACKEND_BASE_URL"
        fi
        
        if [ -n "$BACKEND_TOKEN" ]; then
            update_env_var "BACKEND_TOKEN" "$BACKEND_TOKEN"
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

# #region agent log
LOG_FILE=".cursor/debug.log"
mkdir -p "$(dirname "$LOG_FILE")"
echo "{\"id\":\"install_env_check\",\"timestamp\":$(date +%s000),\"location\":\"install-control.sh:403\",\"message\":\"Checking env file\",\"data\":{\"env_exists\":\"$([ -f .env ] && echo true || echo false)\",\"pwd\":\"$(pwd)\"},\"runId\":\"install_run\",\"hypothesisId\":\"F\"}" >> "$LOG_FILE"
# #endregion

source .env 2>/dev/null || true

# #region agent log
echo "{\"id\":\"install_env_sourced\",\"timestamp\":$(date +%s000),\"location\":\"install-control.sh:410\",\"message\":\"Env file sourced\",\"data\":{\"bot_token_set\":\"$([ -n \"\${BOT_TOKEN:-}\" ] && echo true || echo false)\",\"admin_ids_set\":\"$([ -n \"\${ADMIN_IDS:-}\" ] && echo true || echo false)\",\"domain_set\":\"$([ -n \"\${DOMAIN:-}\" ] && echo true || echo false)\"},\"runId\":\"install_run\",\"hypothesisId\":\"F\"}" >> "$LOG_FILE"
# #endregion

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
mkdir -p data certs data/logs data/logs/caddy
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
# Информация о Caddy (HTTPS)
# ═══════════════════════════════════════════════════════════════

if [ -n "${DOMAIN:-}" ] && [ "$DOMAIN" != "" ]; then
    info "Caddy будет запущен автоматически для HTTPS"
    info "Домен: $DOMAIN"
    info "Caddy автоматически получит SSL сертификат от Let's Encrypt"
    
    # Проверяем наличие Caddyfile
    if [ ! -f Caddyfile ]; then
        warning "Caddyfile не найден, создаем из шаблона..."
        # Caddyfile уже должен быть создан, но на всякий случай проверяем
    fi
else
    info "Домен не указан - HTTPS через Caddy не будет использоваться"
    info "Вы можете указать домен позже и запустить: ./scripts/manage-control.sh caddy-domain <домен>"
fi

# ═══════════════════════════════════════════════════════════════
# Запуск Control Panel
# ═══════════════════════════════════════════════════════════════

echo ""
info "Запуск Control Panel..."
info "Сборка может занять несколько минут..."

# #region agent log
echo "{\"id\":\"install_start_services\",\"timestamp\":$(date +%s000),\"location\":\"install-control.sh:490\",\"message\":\"Starting services\",\"data\":{\"pwd\":\"$(pwd)\",\"manage_script_exists\":\"$([ -f ./scripts/manage-control.sh ] && echo true || echo false)\"},\"runId\":\"install_run\",\"hypothesisId\":\"C\"}" >> "$LOG_FILE"
# #endregion

./scripts/manage-control.sh start

# #region agent log
echo "{\"id\":\"install_services_started\",\"timestamp\":$(date +%s000),\"location\":\"install-control.sh:496\",\"message\":\"Services start command completed\",\"data\":{\"exit_code\":\"$?\"},\"runId\":\"install_run\",\"hypothesisId\":\"C\"}" >> "$LOG_FILE"
# #endregion

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
if [ -n "${DOMAIN:-}" ] && [ "$DOMAIN" != "" ]; then
    echo "  docker logs mtproxy-caddy           — логи Caddy (HTTPS)"
fi
echo "  tail -f data/logs/app-*.log         — файловые логи"
if [ -n "${DOMAIN:-}" ] && [ "$DOMAIN" != "" ]; then
    echo ""
    echo "Управление Caddy (HTTPS):"
    echo "  ./scripts/manage-control.sh caddy-domain <домен>  — изменить домен"
    echo "  ./scripts/manage-control.sh caddy-reload          — перезагрузить конфигурацию"
    echo "  ./scripts/manage-control.sh caddy-cert            — обновить SSL сертификат"
fi
echo ""
echo "Следующие шаги:"
echo "  1. Проверьте статус: ./scripts/manage-control.sh status"
echo "  2. Проверьте логи: ./scripts/manage-control.sh logs"
echo "  3. Добавьте ноды через Telegram бота"
echo ""
