#!/bin/bash
set -e

echo "════════════════════════════════════════════════════"
echo "  MTProxy Management System - Control Panel Setup"
echo "════════════════════════════════════════════════════"
echo ""

# ─── Проверка прав root ───
if [ "$EUID" -ne 0 ]; then 
  echo "❌ Пожалуйста, запустите с sudo"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ─── 1. Установка Docker ───
if ! command -v docker &>/dev/null; then
  echo "📦 Установка Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "✅ Docker установлен"
else
  echo "✅ Docker уже установлен: $(docker --version)"
fi

# ─── 2. Установка Docker Compose ───
if ! command -v docker-compose &>/dev/null; then
  echo "📦 Установка Docker Compose..."
  DOCKER_COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep 'tag_name' | cut -d\" -f4)
  curl -L "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
  chmod +x /usr/local/bin/docker-compose
  echo "✅ Docker Compose установлен: $(docker-compose --version)"
else
  echo "✅ Docker Compose уже установлен: $(docker-compose --version)"
fi

# ─── 3. Установка Node.js (для разработки, опционально) ───
if ! command -v node &>/dev/null; then
  echo "📦 Установка Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  echo "✅ Node.js установлен: $(node --version)"
else
  echo "✅ Node.js уже установлен: $(node --version)"
fi

# ─── 4. Создание директорий ───
echo "📁 Создание директорий..."
mkdir -p data
mkdir -p certs
mkdir -p logs

# ─── 5. Настройка .env ───
if [ ! -f .env ]; then
  echo "📝 Создание .env файла..."
  cp .env.control.example .env
  
  echo ""
  echo "⚠️  ВАЖНО: Отредактируйте .env файл!"
  echo "   nano .env"
  echo ""
  echo "Заполните:"
  echo "  BOT_TOKEN - от @BotFather"
  echo "  ADMIN_IDS - ваши Telegram ID (узнать: @userinfobot)"
  echo ""
  
  read -p "Хотите отредактировать .env сейчас? (y/n): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    nano .env
  else
    echo "⚠️  Не забудьте отредактировать .env перед запуском!"
    exit 0
  fi
fi

# ─── 6. Генерация mTLS сертификатов ───
if [ ! -f certs/ca.crt ]; then
  echo "🔐 Генерация mTLS сертификатов..."
  ./scripts/generate-certs.sh
  echo "✅ Сертификаты сгенерированы в ./certs/"
else
  echo "✅ Сертификаты уже существуют"
fi

# ─── 7. Установка зависимостей и сборка ───
echo "📦 Установка зависимостей..."
npm install

echo "🔨 Сборка TypeScript..."
npm run build

# ─── 8. Создание systemd сервиса ───
echo "🔧 Настройка systemd сервиса..."

cat > /etc/systemd/system/mtproxy-control.service <<EOF
[Unit]
Description=MTProxy Control Panel
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=$SCRIPT_DIR
ExecStart=/usr/local/bin/docker-compose up
ExecStop=/usr/local/bin/docker-compose down
Restart=on-failure
RestartSec=10
StandardOutput=append:$SCRIPT_DIR/logs/control.log
StandardError=append:$SCRIPT_DIR/logs/control.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable mtproxy-control

echo ""
echo "════════════════════════════════════════════════════"
echo "  ✅ Установка Control Panel завершена!"
echo "════════════════════════════════════════════════════"
echo ""
echo "📋 Следующие шаги:"
echo ""
echo "1. Убедитесь что .env настроен:"
echo "   nano .env"
echo ""
echo "2. Запустите Control Panel:"
echo "   sudo systemctl start mtproxy-control"
echo ""
echo "3. Проверьте статус:"
echo "   sudo systemctl status mtproxy-control"
echo ""
echo "4. Просмотрите логи:"
echo "   sudo journalctl -u mtproxy-control -f"
echo "   или"
echo "   tail -f logs/control.log"
echo ""
echo "5. Остановить:"
echo "   sudo systemctl stop mtproxy-control"
echo ""
echo "6. Перезапустить:"
echo "   sudo systemctl restart mtproxy-control"
echo ""
echo "════════════════════════════════════════════════════"
