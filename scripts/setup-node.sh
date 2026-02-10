#!/bin/bash
set -e

echo "════════════════════════════════════════════════════"
echo "  MTProxy Management System - Node Agent Setup"
echo "════════════════════════════════════════════════════"
echo ""

# ─── Проверка прав root ───
if [ "$EUID" -ne 0 ]; then 
  echo "❌ Пожалуйста, запустите с sudo"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(dirname "$SCRIPT_DIR")"
cd "$WORK_DIR"

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

# ─── 3. Определение IP адреса ───
echo "🔍 Определение IP адресов..."
EXTERNAL_IP=$(curl -s https://api.ipify.org)
INTERNAL_IP=$(hostname -I | awk '{print $1}')

echo "   Внешний IP: $EXTERNAL_IP"
echo "   Внутренний IP: $INTERNAL_IP"

# ─── 4. Создание директорий ───
echo "📁 Создание директорий..."
mkdir -p data
mkdir -p logs
mkdir -p socks5
mkdir -p certs

# ─── 5. Настройка .env ───
if [ ! -f .env ]; then
  echo "📝 Создание .env файла..."
  cp .env.node.example .env
  
  # Генерируем API токен
  API_TOKEN=$(openssl rand -hex 32)
  
  # Автоматически заполняем некоторые поля
  sed -i "s/API_TOKEN=.*/API_TOKEN=$API_TOKEN/" .env
  sed -i "s/INTERNAL_IP=.*/INTERNAL_IP=$INTERNAL_IP/" .env
  
  echo ""
  echo "✅ API Token сгенерирован: $API_TOKEN"
  echo ""
  echo "⚠️  ВАЖНО: Отредактируйте .env файл!"
  echo "   nano .env"
  echo ""
  echo "Заполните:"
  echo "  DOMAIN - домен этого сервера (например: proxy1.example.com)"
  echo "  WORKERS - количество CPU ядер (рекомендуется)"
  echo ""
  
  read -p "Введите домен этого сервера: " DOMAIN
  if [ -n "$DOMAIN" ]; then
    sed -i "s/DOMAIN=.*/DOMAIN=$DOMAIN/" .env
  fi
  
  read -p "Введите количество воркеров (по умолчанию 2): " WORKERS
  WORKERS=${WORKERS:-2}
  sed -i "s/WORKERS=.*/WORKERS=$WORKERS/" .env
  
  echo ""
  echo "✅ Базовая настройка .env завершена"
  echo ""
  read -p "Хотите отредактировать .env вручную? (y/n): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    nano .env
  fi
fi

# Загружаем переменные из .env
source .env

# ─── 6. Создание конфигурации SOCKS5 ───
echo "📝 Создание начальной конфигурации SOCKS5..."
cat > socks5/sockd.conf <<EOF
# Dante SOCKS5 Server Configuration

logoutput: stderr

# Internal interface
internal: 0.0.0.0 port = ${SOCKS5_PORT:-1080}

# External interface  
external: eth0

# Authentication methods
clientmethod: none
socksmethod: username

# Client rules
client pass {
  from: 0.0.0.0/0 to: 0.0.0.0/0
}

# SOCKS rules
socks pass {
  from: 0.0.0.0/0 to: 0.0.0.0/0
  protocol: tcp udp
}
EOF

# ─── 7. Скачивание proxy-secret и proxy-multi.conf ───
echo "📥 Скачивание файлов конфигурации MTProxy..."
curl -s https://core.telegram.org/getProxySecret -o data/proxy-secret
curl -s https://core.telegram.org/getProxyConfig -o data/proxy-multi.conf
echo "✅ Файлы скачаны"

# ─── 8. Установка зависимостей Node Agent ───
if [ -d "node-agent" ]; then
  echo "📦 Установка зависимостей Node Agent..."
  cd node-agent
  npm install
  npm run build
  cd ..
  echo "✅ Node Agent собран"
fi

# ─── 9. Создание systemd сервиса ───
echo "🔧 Настройка systemd сервиса..."

cat > /etc/systemd/system/mtproxy-node.service <<EOF
[Unit]
Description=MTProxy Node Agent
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=$WORK_DIR
ExecStart=/usr/local/bin/docker-compose -f docker-compose.node.yml up
ExecStop=/usr/local/bin/docker-compose -f docker-compose.node.yml down
Restart=on-failure
RestartSec=10
StandardOutput=append:$WORK_DIR/logs/node.log
StandardError=append:$WORK_DIR/logs/node.log

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable mtproxy-node

# ─── 10. Настройка файрвола (UFW) ───
if command -v ufw &>/dev/null; then
  echo "🔥 Настройка файрвола (UFW)..."
  ufw allow ${MTPROTO_PORT:-443}/tcp comment 'MTProto Proxy'
  ufw allow ${SOCKS5_PORT:-1080}/tcp comment 'SOCKS5 Proxy'
  ufw allow ${API_PORT:-8080}/tcp comment 'Node Agent API'
  echo "✅ Правила файрвола добавлены"
fi

echo ""
echo "════════════════════════════════════════════════════"
echo "  ✅ Установка Node Agent завершена!"
echo "════════════════════════════════════════════════════"
echo ""
echo "📋 Информация о ноде:"
echo ""
echo "  Домен: $DOMAIN"
echo "  Внешний IP: $EXTERNAL_IP"
echo "  Внутренний IP: $INTERNAL_IP"
echo "  API Token: $API_TOKEN"
echo "  API URL: https://$DOMAIN:${API_PORT:-8080}"
echo "  MTProto Port: ${MTPROTO_PORT:-443}"
echo "  SOCKS5 Port: ${SOCKS5_PORT:-1080}"
echo "  Workers: ${WORKERS:-2}"
echo ""
echo "📋 Следующие шаги:"
echo ""
echo "1. Добавьте эту ноду в Control Panel:"
echo "   Используйте команду /add_node в боте"
echo "   Укажите следующие данные:"
echo "   - Name: Любое имя"
echo "   - Domain: $DOMAIN"
echo "   - IP: $EXTERNAL_IP"
echo "   - API URL: https://$DOMAIN:${API_PORT:-8080}"
echo "   - API Token: $API_TOKEN"
echo ""
echo "2. Запустите Node Agent:"
echo "   sudo systemctl start mtproxy-node"
echo ""
echo "3. Проверьте статус:"
echo "   sudo systemctl status mtproxy-node"
echo ""
echo "4. Просмотрите логи:"
echo "   sudo journalctl -u mtproxy-node -f"
echo "   или"
echo "   tail -f logs/node.log"
echo ""
echo "5. Проверьте работу контейнеров:"
echo "   docker ps"
echo ""
echo "════════════════════════════════════════════════════"
echo ""
echo "⚠️  СОХРАНИТЕ API TOKEN! Он понадобится для добавления ноды в Control Panel."
echo ""
