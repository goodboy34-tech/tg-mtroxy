#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# MTProxy Control Panel — Автономный установщик
# ═══════════════════════════════════════════════════════════════
# 
# Использование (одна команда):
#   curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/install-control-standalone.sh | bash
#   или
#   wget -qO- https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/install-control-standalone.sh | bash

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/YOUR_USERNAME/YOUR_REPO}"
REPO_BRANCH="${REPO_BRANCH:-main}"

# Цвета
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() { echo -e "${BLUE}ℹ${NC} $1"; }
success() { echo -e "${GREEN}✅${NC} $1"; }
warning() { echo -e "${YELLOW}⚠️${NC} $1"; }
error() { echo -e "${RED}❌${NC} $1"; exit 1; }

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  MTProxy Control Panel — Автономная установка"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Проверка и установка зависимостей
if ! command -v git &>/dev/null; then
    info "Установка Git..."
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        if [ "$ID" = "ubuntu" ] || [ "$ID" = "debian" ]; then
            sudo apt-get update -qq
            sudo apt-get install -y -qq git
        else
            error "Установите Git вручную"
        fi
    fi
fi

# Клонирование репозитория
PROJECT_DIR="tg-mtproxy"
if [ -d "$PROJECT_DIR" ]; then
    info "Директория $PROJECT_DIR уже существует, обновляю..."
    cd "$PROJECT_DIR"
    git pull origin "$REPO_BRANCH" || warning "Не удалось обновить"
    cd ..
else
    info "Клонирование репозитория..."
    git clone -b "$REPO_BRANCH" "$REPO_URL" "$PROJECT_DIR" || error "Не удалось клонировать"
fi

# Запуск основного скрипта установки
cd "$PROJECT_DIR" || error "Не удалось перейти в директорию"
chmod +x install-control.sh
./install-control.sh

