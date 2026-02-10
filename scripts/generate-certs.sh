#!/bin/bash
set -e

echo "════════════════════════════════════════════════════"
echo "  Генерация mTLS сертификатов"
echo "════════════════════════════════════════════════════"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="$(dirname "$SCRIPT_DIR")/certs"

mkdir -p "$CERTS_DIR"
cd "$CERTS_DIR"

# ─── 1. Генерация CA (Certificate Authority) ───
echo "🔐 Генерация CA сертификата..."

openssl genrsa -out ca.key 4096

openssl req -new -x509 -days 3650 -key ca.key -out ca.crt \
  -subj "/C=RU/ST=Moscow/L=Moscow/O=MTProxy/OU=CA/CN=MTProxy CA"

echo "✅ CA сертификат создан: ca.crt, ca.key"

# ─── 2. Генерация сертификата для Control Panel ───
echo "🔐 Генерация сертификата для Control Panel..."

openssl genrsa -out control.key 2048

openssl req -new -key control.key -out control.csr \
  -subj "/C=RU/ST=Moscow/L=Moscow/O=MTProxy/OU=Control/CN=control.mtproxy.local"

openssl x509 -req -in control.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out control.crt -days 365

rm control.csr

echo "✅ Control Panel сертификат создан: control.crt, control.key"

# ─── 3. Функция для генерации сертификата для ноды ───
generate_node_cert() {
  local NODE_NAME=$1
  local NODE_DOMAIN=$2
  
  echo "🔐 Генерация сертификата для ноды: $NODE_NAME"
  
  openssl genrsa -out "node-${NODE_NAME}.key" 2048
  
  openssl req -new -key "node-${NODE_NAME}.key" -out "node-${NODE_NAME}.csr" \
    -subj "/C=RU/ST=Moscow/L=Moscow/O=MTProxy/OU=Node/CN=${NODE_DOMAIN}"
  
  openssl x509 -req -in "node-${NODE_NAME}.csr" -CA ca.crt -CAkey ca.key \
    -CAcreateserial -out "node-${NODE_NAME}.crt" -days 365
  
  rm "node-${NODE_NAME}.csr"
  
  echo "✅ Сертификат для ноды создан: node-${NODE_NAME}.crt, node-${NODE_NAME}.key"
}

# ─── 4. Генерация сертификатов для первых нод (примеры) ───
echo ""
read -p "Создать сертификаты для нод сейчас? (y/n): " -n 1 -r
echo

if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo ""
  echo "Примеры:"
  echo "  Имя: node1, Домен: proxy1.example.com"
  echo "  Имя: node2, Домен: proxy2.example.com"
  echo ""
  
  while true; do
    read -p "Введите имя ноды (или 'q' для выхода): " NODE_NAME
    if [ "$NODE_NAME" = "q" ]; then
      break
    fi
    
    read -p "Введите домен ноды: " NODE_DOMAIN
    
    if [ -n "$NODE_NAME" ] && [ -n "$NODE_DOMAIN" ]; then
      generate_node_cert "$NODE_NAME" "$NODE_DOMAIN"
      echo ""
    fi
  done
fi

echo ""
echo "════════════════════════════════════════════════════"
echo "  ✅ Генерация сертификатов завершена!"
echo "════════════════════════════════════════════════════"
echo ""
echo "📁 Сертификаты находятся в: $CERTS_DIR"
echo ""
echo "📋 Созданные файлы:"
ls -lh "$CERTS_DIR"
echo ""
echo "📝 Использование:"
echo ""
echo "  Control Panel:"
echo "    - ca.crt (CA сертификат)"
echo "    - control.crt, control.key"
echo ""
echo "  Каждая нода:"
echo "    - ca.crt (тот же CA)"
echo "    - node-<name>.crt, node-<name>.key"
echo ""
echo "⚠️  ВАЖНО: Скопируйте ca.crt и соответствующие"
echo "   сертификаты на каждую ноду в директорию certs/"
echo ""
echo "Пример копирования на ноду:"
echo "  scp certs/ca.crt root@node1:/path/to/mtproxy/certs/"
echo "  scp certs/node-node1.* root@node1:/path/to/mtproxy/certs/"
echo ""
