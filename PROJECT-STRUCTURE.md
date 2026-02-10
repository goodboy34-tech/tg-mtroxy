# 📁 Структура проекта

Проект разделен на **2 отдельные папки** с независимой установкой.

## 🎛️ Control Panel

**Расположение:** `control-panel/`

**Назначение:** Telegram бот для централизованного управления всеми нодами

**Файлы:**
```
control-panel/
├── src/
│   ├── bot.ts                    # Основной файл бота
│   ├── database.ts               # SQLite база данных
│   ├── subscription-manager.ts   # Управление подписками
│   └── node-client.ts            # API клиент для нод
│
├── scripts/
│   ├── install.sh                # Скрипт установки
│   └── uninstall.sh              # Скрипт удаления
│
├── package.json                  # npm зависимости
├── tsconfig.json                 # TypeScript конфигурация
├── Dockerfile                    # Docker образ
├── docker-compose.yml            # Docker Compose конфигурация
├── .env.example                  # Пример переменных окружения
└── README.md                     # Документация
```

**Установка:**
```bash
cd control-panel
sudo bash scripts/install.sh
```

**Удаление:**
```bash
cd control-panel
sudo bash scripts/uninstall.sh
```

---

## 🚀 Node Agent

**Расположение:** `node-agent/`

**Назначение:** Агент на каждом прокси-сервере (MTProxy + SOCKS5 + API)

**Файлы:**
```
node-agent/
├── src/
│   └── api.ts                    # HTTP API сервер
│
├── scripts/
│   ├── install.sh                # Скрипт установки
│   └── uninstall.sh              # Скрипт удаления
│
├── socks5/
│   ├── Dockerfile                # Docker образ для 3proxy
│   ├── 3proxy.cfg.template       # Шаблон конфигурации
│   └── entrypoint.sh             # Entrypoint скрипт
│
├── package.json                  # npm зависимости
├── tsconfig.json                 # TypeScript конфигурация
├── Dockerfile                    # Docker образ Node API
├── Dockerfile.mtproxy            # Docker образ MTProxy
├── docker-compose.yml            # Docker Compose конфигурация
├── .env.example                  # Пример переменных окружения
└── README.md                     # Документация
```

**Установка:**
```bash
cd node-agent
sudo bash scripts/install.sh
```

**Удаление:**
```bash
cd node-agent
sudo bash scripts/uninstall.sh
```

---

## 📄 Корневые файлы

```
tg-mtproxy/
├── README.md                     # Главная документация
├── INSTALLATION.md               # Пошаговая инструкция установки
├── PROJECT-STRUCTURE.md          # Этот файл
├── .gitignore                    # Git ignore
└── .git/                         # Git репозиторий
```

---

## 🔄 Рабочий процесс

### 1. Разработка

```bash
# Control Panel
cd control-panel
npm install
npm run dev

# Node Agent
cd node-agent
npm install
npm run dev
```

### 2. Сборка

```bash
# Control Panel
cd control-panel
npm run build
# → dist/bot.js

# Node Agent
cd node-agent
npm run build
# → dist/api.js
```

### 3. Docker

```bash
# Control Panel
cd control-panel
docker-compose up -d --build

# Node Agent
cd node-agent
docker-compose up -d --build
```

---

## 📦 Зависимости

### Control Panel

**Runtime:**
- `telegraf` - Telegram Bot API
- `better-sqlite3` - SQLite база данных
- `node-cron` - планировщик задач
- `dotenv` - переменные окружения

**Development:**
- `typescript` - TypeScript компилятор
- `@types/node` - типы для Node.js
- `@types/better-sqlite3` - типы для SQLite
- `@types/node-cron` - типы для cron
- `ts-node` - выполнение TypeScript

### Node Agent

**Runtime:**
- `dotenv` - переменные окружения
- `express` - HTTP сервер (если добавите)

**Development:**
- `typescript` - TypeScript компилятор
- `@types/node` - типы для Node.js
- `ts-node` - выполнение TypeScript

**Docker Images:**
- `node:20-alpine` - Node.js runtime
- `telegrammessenger/mtproxy:latest` - MTProxy
- `3proxy` - SOCKS5 прокси

---

## 🔐 Конфигурация

### Control Panel (.env)

```bash
BOT_TOKEN=your_telegram_bot_token
ADMIN_IDS=123456789,987654321
DB_PATH=./data/mtproxy.db
HEALTH_CHECK_INTERVAL=5m
CLEANUP_INTERVAL=24h
```

### Node Agent (.env)

```bash
NODE_NAME=Node1
DOMAIN=proxy.example.com
API_KEY=generate_with_openssl_rand_hex_32

MTPROTO_PORT=443
SOCKS5_PORT=1080
API_PORT=3001

WORKERS=4
SECRET=generate_with_openssl_rand_hex_16

NAT=
FAKE_TLS_DOMAIN=www.google.com
```

---

## 🗂️ База данных Control Panel

**Файл:** `control-panel/data/mtproxy.db`

**Таблицы:**

1. **nodes** - список нод
   - id, name, domain, api_url, api_key, mtproto_port, socks5_port, workers
   - is_active, last_health_check, created_at

2. **mtproto_secrets** - MTProto секреты
   - id, node_id, secret, is_fake_tls, is_active, created_at

3. **socks5_accounts** - SOCKS5 аккаунты
   - id, node_id, username, password, is_active, created_at

4. **subscriptions** - подписки пользователей
   - id, user_id, name, node_id, mtproto_count, socks5_count
   - subscription_id, is_active, last_refreshed, created_at

5. **logs** - логи действий
   - id, action, details, created_at

---

## 🌐 Порты

### Control Panel
- Не использует входящие порты (только исходящие к нодам)

### Node Agent
- **443** - MTProxy (TCP)
- **1080** - SOCKS5 (TCP)
- **3001** - Node API (HTTPS)

---

## 📊 Масштабирование

### Вертикальное (одна нода)
- Увеличить количество воркеров: `/set_workers <node_id> <count>`
- Максимум: 16 воркеров = 960,000 соединений

### Горизонтальное (несколько нод)
- Установить Node Agent на новый сервер
- Добавить через `/add_node`
- Создать прокси через `/add_secret` и `/add_socks5`
- Подписки автоматически распределяются

---

## 🛡️ Безопасность

### Control Panel
- Авторизация по ADMIN_IDS
- SQLite база с локальным доступом
- Логирование всех действий

### Node Agent
- API Key аутентификация (заголовок X-API-Key)
- HTTPS с самоподписанными сертификатами
- Firewall правила (UFW)
- Изоляция через Docker

---

## 📝 Логи

### Control Panel
```bash
docker-compose logs -f
# Логи бота: запуск, команды, ошибки
```

### Node Agent
```bash
docker-compose logs -f mtproxy   # MTProxy логи
docker-compose logs -f socks5    # SOCKS5 логи
docker-compose logs -f node-agent # API логи
```

### Через бота
```
/logs <node_id> [lines]
# Получить логи MTProxy и SOCKS5 из Telegram
```

---

## 🔄 CI/CD (для будущего)

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-control-panel:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Deploy Control Panel
        run: |
          ssh user@control-server "cd control-panel && git pull && docker-compose up -d --build"

  deploy-nodes:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [node1, node2, node3]
    steps:
      - uses: actions/checkout@v2
      - name: Deploy Node
        run: |
          ssh user@${{ matrix.node }} "cd node-agent && git pull && docker-compose up -d --build"
```

---

## 📚 Ссылки на документацию

- [Главный README](./README.md) - обзор системы
- [Control Panel README](./control-panel/README.md) - документация бота
- [Node Agent README](./node-agent/README.md) - документация агента
- [Инструкция по установке](./INSTALLATION.md) - пошаговая установка

---

**Структура готова к production использованию!** ✅
