#!/usr/bin/env bash
set -euo pipefail

echo "═══════════════════════════════════════"
echo "  MTProxy Control Panel — установка"
echo "═══════════════════════════════════════"
echo ""

# Проверка Docker
if ! command -v docker &>/dev/null; then
  echo "❌ Docker не найден."
  echo "Установите Docker: https://docs.docker.com/engine/install/"
  exit 1
fi

if ! docker compose version &>/dev/null; then
  echo "❌ docker compose не найден."
  echo "Установите Docker Compose plugin."
  exit 1
fi

echo "✅ Docker найден: $(docker --version)"
echo "✅ Docker Compose найден: $(docker compose version)"
echo ""

# Создание .env если нет
if [ ! -f .env ]; then
  echo "📝 Создаю .env из ENV.example..."
  cp ENV.example .env
  echo ""
  echo "═══════════════════════════════════════"
  echo "  Настройка переменных окружения"
  echo "═══════════════════════════════════════"
  echo ""
  echo "Заполните обязательные переменные в .env:"
  echo ""
  echo "  BOT_TOKEN          — токен бота от @BotFather"
  echo "  ADMIN_IDS          — ваш Telegram ID (через запятую для нескольких)"
  echo "  REMNAWAVE_API_KEY  — секретный ключ для Remnawave API"
  echo "  WEB_API_KEY        — секретный ключ для Web API"
  echo "  BACKEND_BASE_URL   — URL вашего backend (api-1.yaml)"
  echo "  BACKEND_TOKEN      — токен для backend API"
  echo ""
  echo "Redis (обязательно для продакшена):"
  echo "  REDIS_HOST         — хост Redis (по умолчанию redis)"
  echo "  REDIS_PORT         — порт Redis (по умолчанию 6379)"
  echo ""
  echo "Опционально (для продаж):"
  echo "  YOOMONEY_TOKEN     — токен API YooMoney"
  echo "  YOOMONEY_WALLET    — номер кошелька YooMoney"
  echo ""
  read -p "Открыть .env для редактирования? [y/N] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    ${EDITOR:-nano} .env
  else
    echo ""
    echo "Отредактируйте .env вручную и запустите снова:"
    echo "  nano .env"
    echo "  ./install-control.sh"
    exit 0
  fi
fi

# Проверка обязательных переменных
source .env 2>/dev/null || true

if [ -z "${BOT_TOKEN:-}" ] || [ -z "${ADMIN_IDS:-}" ]; then
  echo ""
  echo "⚠️  В .env не заполнены обязательные переменные:"
  echo "   BOT_TOKEN и ADMIN_IDS"
  echo ""
  read -p "Открыть .env для редактирования? [y/N] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    ${EDITOR:-nano} .env
    echo "Запустите скрипт снова: ./install-control.sh"
    exit 0
  else
    echo "Заполните .env и запустите снова."
    exit 1
  fi
fi

# Создание директорий
echo ""
echo "📁 Создаю необходимые директории..."
mkdir -p data certs data/logs
chmod +x scripts/manage-control.sh 2>/dev/null || true

# Проверка Redis (будет запущен через docker-compose)
echo ""
echo "📦 Redis будет запущен автоматически через docker-compose"
echo "   (обязателен для продакшена с тысячами пользователей)"

# Запуск
echo ""
echo "🚀 Запускаю Control Panel..."
./scripts/manage-control.sh start

echo ""
echo "═══════════════════════════════════════"
echo "  ✅ Control Panel установлен!"
echo "═══════════════════════════════════════"
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
echo ""
