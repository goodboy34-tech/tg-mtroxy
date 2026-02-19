#!/usr/bin/env bash
set -euo pipefail

echo "═══════════════════════════════════════"
echo "  MTProxy Node Agent — установка"
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
  read -p "Открыть .env для редактирования? [y/N] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    ${EDITOR:-nano} .env
  else
    echo ""
    echo "Отредактируйте .env вручную и запустите снова:"
    echo "  nano .env"
    echo "  ./install-node.sh"
    exit 0
  fi
fi

# Проверка обязательных переменных
source .env 2>/dev/null || true

if [ -z "${API_TOKEN:-}" ] || [ -z "${DOMAIN:-}" ]; then
  echo ""
  echo "⚠️  В .env не заполнены обязательные переменные:"
  echo "   API_TOKEN и DOMAIN"
  echo ""
  read -p "Открыть .env для редактирования? [y/N] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    ${EDITOR:-nano} .env
    echo "Запустите скрипт снова: ./install-node.sh"
    exit 0
  else
    echo "Заполните .env и запустите снова."
    exit 1
  fi
fi

# Создание директорий
echo ""
echo "📁 Создаю необходимые директории..."
mkdir -p node-data
chmod +x scripts/manage-node.sh 2>/dev/null || true

# Запуск
echo ""
echo "🚀 Запускаю Node Agent..."
./scripts/manage-node.sh start

echo ""
echo "═══════════════════════════════════════"
echo "  ✅ Node Agent установлен!"
echo "═══════════════════════════════════════"
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
echo "Следующий шаг:"
echo "  Добавьте эту ноду в Control Panel через бота: /add_node"
echo "  API URL: http://$(hostname -I | awk '{print $1}'):8080"
echo "  API Token: ${API_TOKEN}"
echo ""
