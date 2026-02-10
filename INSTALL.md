# 🚀 MTProxy Management System - Инструкция по установке

Система управления MTProto и SOCKS5 прокси-серверами через Telegram бот.

## 📦 Компоненты

1. **Control Panel** - главный сервер с Telegram ботом для управления
2. **Node Agent** - агент на каждой ноде для управления прокси
3. **Local Proxy** (опционально) - прокси на самом сервере Control Panel

## 🔧 Установка Control Panel

### 1. Клонируйте репозиторий

```bash
git clone <repo-url>
cd tg-mtproxy
```

### 2. Запустите скрипт установки

```bash
chmod +x scripts/*.sh
sudo ./scripts/setup-control.sh
```

Скрипт автоматически:
- ✅ Установит Docker и Docker Compose
- ✅ Установит Node.js (опционально, для разработки)
- ✅ Создаст необходимые директории
- ✅ Сгенерирует mTLS сертификаты
- ✅ Установит зависимости и соберет проект
- ✅ Создаст systemd сервис

### 3. Настройте `.env`

```bash
nano .env
```

**Обязательно укажите:**
- `BOT_TOKEN` - получить у @BotFather
- `ADMIN_IDS` - ваши Telegram ID (узнать у @userinfobot)

**Опционально (локальный прокси):**
- `LOCAL_PROXY_ENABLED=true` - включить прокси на этом же сервере
- `LOCAL_MTPROTO_PORT=8443` - порт MTProto
- `LOCAL_SOCKS5_PORT=1081` - порт SOCKS5

### 4. Запустите Control Panel

```bash
sudo systemctl start mtproxy-control
```

### 5. Проверьте статус

```bash
sudo systemctl status mtproxy-control
# или
tail -f logs/control.log
```

## 🌐 Установка Node Agent (на каждой ноде)

### 1. Скопируйте файлы на ноду

```bash
scp -r node-agent/ .env.node.example scripts/setup-node.sh root@your-node:/root/mtproxy-node/
```

### 2. На ноде: запустите скрипт установки

```bash
cd /root/mtproxy-node
chmod +x scripts/*.sh
sudo ./scripts/setup-node.sh
```

Скрипт автоматически:
- ✅ Установит Docker и Docker Compose
- ✅ Определит IP адреса (внешний и внутренний)
- ✅ Сгенерирует API токен
- ✅ Настроит .env
- ✅ Создаст конфигурацию SOCKS5
- ✅ Скачает proxy-secret и proxy-multi.conf
- ✅ Соберет Node Agent
- ✅ Создаст systemd сервис
- ✅ Настроит файрвол (UFW)

### 3. Сохраните API Token

```
⚠️ ВАЖНО: Скрипт выведет API Token - сохраните его!
```

### 4. Запустите Node Agent

```bash
sudo systemctl start mtproxy-node
```

### 5. Проверьте статус

```bash
sudo systemctl status mtproxy-node
# или
docker ps
```

## 🤖 Использование бота

### Добавление ноды

1. Напишите боту `/add_node`
2. Отправьте данные в формате:

```
name: Node 1
domain: proxy1.example.com
ip: 1.2.3.4
api_url: https://proxy1.example.com:8080
mtproto_port: 443
socks5_port: 1080
workers: 4
cpu_cores: 4
ram_mb: 2048
```

Или используйте интерактивный режим.

### Основные команды

**Управление нодами:**
- `/nodes` - список всех нод
- `/node <id>` - информация о ноде
- `/remove_node <id>` - удалить ноду
- `/restart_node <id>` - перезапустить прокси

**Получение доступов:**
- `/links <node_id>` - все ссылки для ноды
- `/add_secret <node_id>` - добавить MTProto секрет
- `/add_socks5 <node_id>` - добавить SOCKS5 аккаунт

**Мониторинг:**
- `/stats` - общая статистика
- `/health` - здоровье всех нод
- `/logs <node_id>` - логи ноды

**Настройки:**
- `/set_workers <node_id> <count>` - установить количество воркеров

## 🔗 Локальный прокси (на сервере Control Panel)

### Включение

В `.env` установите:
```bash
LOCAL_PROXY_ENABLED=true
```

### Управление

```bash
# Запуск
./scripts/local-proxy.sh start

# Остановка
./scripts/local-proxy.sh stop

# Перезапуск
./scripts/local-proxy.sh restart

# Статус
./scripts/local-proxy.sh status

# Получить ссылки
./scripts/local-proxy.sh links

# Логи
./scripts/local-proxy.sh logs

# Сгенерировать новый секрет
./scripts/local-proxy.sh generate
```

### Получение ссылок

```bash
./scripts/local-proxy.sh links
```

Выведет:
- MTProto Fake-TLS (dd) ссылка
- MTProto обычная ссылка
- SOCKS5 ссылка

## 🔐 mTLS Сертификаты

### Генерация

```bash
./scripts/generate-certs.sh
```

Скрипт создаст:
- `certs/ca.crt` и `certs/ca.key` - Certificate Authority
- `certs/control.crt` и `certs/control.key` - для Control Panel
- `certs/node-<name>.crt` и `certs/node-<name>.key` - для каждой ноды

### Копирование на ноды

```bash
# CA сертификат (общий для всех)
scp certs/ca.crt root@node1:/root/mtproxy-node/certs/

# Сертификат конкретной ноды
scp certs/node-node1.crt certs/node-node1.key root@node1:/root/mtproxy-node/certs/
```

## 🌟 Возможности MTProto

### Fake-TLS (dd префикс)

Обход DPI (Deep Packet Inspection) блокировок:
- Добавляет случайный padding к пакетам
- Включается префиксом `dd` к секрету
- Рекомендуется для стран с блокировками

### Воркеры (Workers)

- Один воркер обрабатывает до 60,000 подключений
- Рекомендуется: количество CPU ядер
- Настраивается через `WORKERS` в `.env`

### Домены через NAT

Для работы за NAT с доменом:
```bash
INTERNAL_IP=10.0.0.5
DOMAIN=proxy1.example.com
```

MTProto автоматически использует `--nat-info` для mapping.

## 📊 Мониторинг

### Статистика MTProto

Доступна через `http://localhost:2398/stats`:
- `total_special_connections` - подключения клиентов
- `total_max_special_connections` - максимум (60000 * workers)
- `ready_targets` - серверы Telegram
- `active_targets` - активные подключения к Telegram

### Node Agent API

Endpoints (требуется Bearer Token):
- `GET /health` - здоровье ноды
- `GET /stats` - статистика прокси
- `POST /restart` - перезапуск
- `POST /mtproto/secrets` - добавить секрет
- `DELETE /mtproto/secrets/:secret` - удалить секрет
- `POST /socks5/accounts` - добавить SOCKS5 аккаунт

### Логи

```bash
# Control Panel
sudo journalctl -u mtproxy-control -f
# или
tail -f logs/control.log

# Node Agent
sudo journalctl -u mtproxy-node -f
# или
tail -f logs/node.log

# Docker контейнеры
docker logs -f mtproxy
docker logs -f mtproxy-socks5
docker logs -f mtproxy-node-agent
```

## 🔧 Управление сервисами

### Control Panel

```bash
# Запуск
sudo systemctl start mtproxy-control

# Остановка
sudo systemctl stop mtproxy-control

# Перезапуск
sudo systemctl restart mtproxy-control

# Статус
sudo systemctl status mtproxy-control

# Отключить автозапуск
sudo systemctl disable mtproxy-control

# Включить автозапуск
sudo systemctl enable mtproxy-control
```

### Node Agent

```bash
# Запуск
sudo systemctl start mtproxy-node

# Остановка
sudo systemctl stop mtproxy-node

# Перезапуск
sudo systemctl restart mtproxy-node

# Статус
sudo systemctl status mtproxy-node
```

## 🐛 Решение проблем

### Бот не запускается

1. Проверьте `.env`:
```bash
cat .env | grep BOT_TOKEN
cat .env | grep ADMIN_IDS
```

2. Проверьте логи:
```bash
sudo journalctl -u mtproxy-control -n 50
```

### Нода не отвечает

1. Проверьте статус контейнеров:
```bash
docker ps
```

2. Проверьте логи:
```bash
docker logs mtproxy-node-agent
docker logs mtproxy
```

3. Проверьте API Token:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" https://your-node:8080/ping
```

### MTProto не работает

1. Проверьте порты:
```bash
sudo netstat -tulpn | grep 443
```

2. Проверьте файрвол:
```bash
sudo ufw status
```

3. Обновите proxy-secret и proxy-multi.conf:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  -X POST https://your-node:8080/system/update-proxy-files
```

### SOCKS5 не работает

1. Проверьте конфигурацию:
```bash
cat socks5/sockd.conf
```

2. Перезапустите контейнер:
```bash
docker restart mtproxy-socks5
```

## 📚 Структура проекта

```
tg-mtproxy/
├── src/                      # Control Panel
│   ├── index.ts             # Точка входа
│   ├── bot.ts               # Telegram бот
│   ├── database.ts          # База данных
│   └── node-client.ts       # Клиент для нод
│
├── node-agent/              # Node Agent
│   ├── src/
│   │   └── api.ts          # API сервер
│   ├── Dockerfile
│   └── package.json
│
├── scripts/                 # Скрипты
│   ├── setup-control.sh    # Установка Control Panel
│   ├── setup-node.sh       # Установка Node Agent
│   ├── generate-certs.sh   # Генерация mTLS сертификатов
│   └── local-proxy.sh      # Управление локальным прокси
│
├── docker-compose.yml       # Control Panel + Local Proxy
├── docker-compose.node.yml  # Node Agent
│
├── .env.control.example     # Пример для Control Panel
└── .env.node.example        # Пример для Node Agent
```

## 🔄 Обновление

### Control Panel

```bash
cd /path/to/tg-mtproxy
git pull
npm install
npm run build
sudo systemctl restart mtproxy-control
```

### Node Agent

```bash
cd /path/to/mtproxy-node
# Скопируйте новые файлы с Control Panel
scp -r root@control-panel:/path/to/tg-mtproxy/node-agent/* ./node-agent/
cd node-agent
npm install
npm run build
sudo systemctl restart mtproxy-node
```

## 💡 Советы

1. **Регулярно обновляйте proxy-secret и proxy-multi.conf** (раз в день):
   ```bash
   curl -H "Authorization: Bearer TOKEN" -X POST https://node:8080/system/update-proxy-files
   ```

2. **Мониторьте использование RAM и CPU**:
   ```bash
   /stats в боте
   ```

3. **Используйте Fake-TLS (dd) для стран с блокировками**

4. **Настройте количество воркеров по количеству CPU ядер**

5. **Регистрируйте прокси у @MTProxybot для статистики**

6. **Включите автоматические обновления** proxy-secret через cron:
   ```bash
   0 3 * * * curl -H "Authorization: Bearer TOKEN" -X POST https://node:8080/system/update-proxy-files
   ```

## 📞 Поддержка

Если возникли вопросы:
1. Проверьте логи (`/logs` в боте)
2. Изучите раздел "Решение проблем"
3. Откройте Issue в GitHub

## 📄 Лицензия

MIT License
