#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# MTProxy Management System — Универсальный установщик
# ═══════════════════════════════════════════════════════════════
# 
# Использование:
#   curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/install.sh | bash -s control
#   curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/install.sh | bash -s node
#
# Или скачать и запустить:
#   wget -qO- https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/install.sh | bash -s control
#   wget -qO- https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/install.sh | bash -s node

set -euo pipefail

# Цвета для вывода
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функции для вывода
info() { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✅${NC} $1"; }
warning() { echo -e "${YELLOW}⚠️${NC} $1"; }
error() { echo -e "${RED}❌${NC} $1"; exit 1; }

# Определяем тип установки
INSTALL_TYPE="${1:-}"
if [ -z "$INSTALL_TYPE" ]; then
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "  MTProxy Management System — Установщик"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    echo "Выберите тип установки:"
    echo "  1) control  — Control Panel (главный сервер управления)"
    echo "  2) node     — Node Agent (прокси-нода)"
    echo ""
    read -p "Введите тип установки [control/node]: " INSTALL_TYPE
fi

INSTALL_TYPE=$(echo "$INSTALL_TYPE" | tr '[:upper:]' '[:lower:]')

if [ "$INSTALL_TYPE" != "control" ] && [ "$INSTALL_TYPE" != "node" ]; then
    error "Неверный тип установки. Используйте 'control' или 'node'"
fi

# ═══════════════════════════════════════════════════════════════
# Проверка и установка зависимостей
# ═══════════════════════════════════════════════════════════════

check_command() {
    if command -v "$1" &> /dev/null; then
        return 0
    else
        return 1
    fi
}

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
            
            info "Установка Docker..."
            sudo apt-get update -qq
            sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
            
            success "Docker установлен"
            ;;
        *)
            warning "Автоматическая установка Docker для $OS не поддерживается"
            info "Установите Docker вручную: https://docs.docker.com/engine/install/"
            exit 1
            ;;
    esac
}

check_dependencies() {
    info "Проверка зависимостей..."
    
    local missing_deps=()
    
    # Проверка Docker
    if ! check_command docker; then
        missing_deps+=("docker")
        warning "Docker не найден"
        read -p "Установить Docker автоматически? [y/N] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            install_docker
        else
            error "Установите Docker: https://docs.docker.com/engine/install/"
        fi
    else
        success "Docker найден: $(docker --version)"
    fi
    
    # Проверка docker compose
    if ! docker compose version &> /dev/null; then
        missing_deps+=("docker-compose")
        error "Docker Compose не найден. Установите Docker Compose plugin."
    else
        success "Docker Compose найден: $(docker compose version)"
    fi
    
    # Проверка Git (для клонирования репозитория)
    if ! check_command git; then
        warning "Git не найден, но это не критично"
        if [ -f /etc/os-release ]; then
            . /etc/os-release
            if [ "$ID" = "ubuntu" ] || [ "$ID" = "debian" ]; then
                read -p "Установить Git? [y/N] " -n 1 -r
                echo
                if [[ $REPLY =~ ^[Yy]$ ]]; then
                    sudo apt-get update -qq && sudo apt-get install -y -qq git
                    success "Git установлен"
                fi
            fi
        fi
    else
        success "Git найден: $(git --version)"
    fi
    
    # Проверка curl/wget
    if ! check_command curl && ! check_command wget; then
        error "Необходим curl или wget для скачивания файлов"
    fi
    
    # Проверка прав на Docker
    if ! docker ps &> /dev/null; then
        warning "Нет прав на выполнение Docker команд"
        info "Добавление пользователя в группу docker..."
        sudo usermod -aG docker "$USER"
        success "Пользователь добавлен в группу docker"
        warning "Выйдите и войдите снова, или выполните: newgrp docker"
    fi
}

# ═══════════════════════════════════════════════════════════════
# Определение репозитория
# ═══════════════════════════════════════════════════════════════

REPO_URL="${REPO_URL:-}"
REPO_BRANCH="${REPO_BRANCH:-main}"

if [ -z "$REPO_URL" ]; then
    echo ""
    info "Укажите URL репозитория GitHub:"
    echo "  Пример: https://github.com/username/tg-mtproxy"
    read -p "URL репозитория: " REPO_URL
    
    if [ -z "$REPO_URL" ]; then
        error "URL репозитория обязателен"
    fi
fi

# Нормализация URL
REPO_URL=$(echo "$REPO_URL" | sed 's/\.git$//')
REPO_URL=$(echo "$REPO_URL" | sed 's|^https://github.com/||')
REPO_URL="https://github.com/$REPO_URL"

# ═══════════════════════════════════════════════════════════════
# Клонирование или обновление репозитория
# ═══════════════════════════════════════════════════════════════

PROJECT_DIR="tg-mtproxy"

if [ -d "$PROJECT_DIR" ]; then
    info "Директория $PROJECT_DIR уже существует"
    read -p "Обновить репозиторий? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        info "Обновление репозитория..."
        cd "$PROJECT_DIR"
        git pull origin "$REPO_BRANCH" || warning "Не удалось обновить репозиторий"
        cd ..
    fi
else
    if check_command git; then
        info "Клонирование репозитория..."
        git clone -b "$REPO_BRANCH" "$REPO_URL" "$PROJECT_DIR" || error "Не удалось клонировать репозиторий"
        success "Реопозиторий клонирован"
    else
        error "Git не найден. Установите Git или укажите REPO_URL для скачивания архива."
    fi
fi

cd "$PROJECT_DIR" || error "Не удалось перейти в директорию проекта"

# ═══════════════════════════════════════════════════════════════
# Запуск соответствующего скрипта установки
# ═══════════════════════════════════════════════════════════════

if [ "$INSTALL_TYPE" = "control" ]; then
    info "Запуск установки Control Panel..."
    chmod +x install-control.sh
    ./install-control.sh
elif [ "$INSTALL_TYPE" = "node" ]; then
    info "Запуск установки Node Agent..."
    chmod +x install-node.sh
    ./install-node.sh
fi

success "Установка завершена!"

