#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
# MTProxy Control Panel — Автономный установщик
# ═══════════════════════════════════════════════════════════════
# 
# Использование (одна команда):
#   bash <(curl -Ls https://github.com/goodboy34-tech/tg-mtroxy/raw/master/install-control-standalone.sh)

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/goodboy34-tech/tg-mtroxy}"
REPO_BRANCH="${REPO_BRANCH:-master}"

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

# Определяем имя директории из URL репозитория (до удаления .git)
if [[ "$REPO_URL" =~ /([^/]+)\.git?$ ]] || [[ "$REPO_URL" =~ /([^/]+)/?$ ]]; then
    PROJECT_DIR="${BASH_REMATCH[1]}"
else
    PROJECT_DIR="tg-mtroxy"
fi

# Убираем .git из URL для git clone (работает и с .git и без)
REPO_URL_CLONE=$(echo "$REPO_URL" | sed 's/\.git$//')

info "Реопозиторий: $REPO_URL_CLONE"
info "Ветка: $REPO_BRANCH"
info "Директория: $PROJECT_DIR"

# Клонирование репозитория
if [ -d "$PROJECT_DIR" ]; then
    info "Директория $PROJECT_DIR уже существует, обновляю..."
    cd "$PROJECT_DIR"
    git pull origin "$REPO_BRANCH" || warning "Не удалось обновить"
    cd ..
else
    info "Клонирование репозитория..."
    git clone -b "$REPO_BRANCH" "$REPO_URL_CLONE" "$PROJECT_DIR" || error "Не удалось клонировать репозиторий"
fi

# Запуск основного скрипта установки
cd "$PROJECT_DIR" || error "Не удалось перейти в директорию: $PROJECT_DIR"
chmod +x install-control.sh
./install-control.sh

