# Скрипты установки и управления

## Основные скрипты

| Скрипт | Назначение |
|--------|------------|
| `install-control.sh` | Установка Control Panel на главном сервере (интерактивная настройка) |
| `install-node.sh` | Установка Node Agent на каждой ноде (интерактивная настройка) |
| `update.sh` | Обновление Control Panel (git pull + restart) |
| `update-node.sh` | Обновление Node Agent |
| `scripts/manage-control.sh` | Управление Control Panel (start/stop/restart/logs/status) |
| `scripts/manage-node.sh` | Управление Node Agent |

## Что устанавливать где

- **Главный сервер**: `install-control.sh` → Control Panel (бот, API, БД)
- **Каждая нода**: `install-node.sh` → Node Agent (MTProto, SOCKS5)

## Процесс установки

### Control Panel

```bash
./install-control.sh
```

Скрипт автоматически:
1. Проверяет наличие Docker и Docker Compose
2. Создаёт `.env` из `ENV.example` если его нет
3. Предлагает открыть `.env` для редактирования
4. Проверяет обязательные переменные (`BOT_TOKEN`, `ADMIN_IDS`)
5. Создаёт необходимые директории (`data/`, `certs/`)
6. Запускает Control Panel через Docker Compose

### Node Agent

```bash
./install-node.sh
```

Скрипт автоматически:
1. Проверяет наличие Docker и Docker Compose
2. Создаёт `.env` из `ENV.example` если его нет
3. Предлагает открыть `.env` для редактирования
4. Проверяет обязательные переменные (`API_TOKEN`, `DOMAIN`)
5. Создаёт директорию `node-data/`
6. Запускает Node Agent через Docker Compose

## Устаревшие файлы

Следующие скрипты удалены или помечены как устаревшие:

- ✅ `setup.sh` — устарел, перенаправляет на `install-control.sh`
- ✅ `install-server.sh`, `install-node-new.sh`, `install-node-simple.sh` — удалены (дубликаты)
- ✅ `SERVER_UPDATE.sh`, `UPDATE_SERVER.sh` — удалены (дубликаты)

## Переменные окружения

Скрипты установки автоматически создают `.env` из `ENV.example` и предлагают его отредактировать.

**Для Control Panel** (обязательные):
- `BOT_TOKEN` — токен бота от @BotFather
- `ADMIN_IDS` — ваш Telegram ID (через запятую для нескольких)
- `REMNAWAVE_API_KEY` — секретный ключ для Remnawave API
- `WEB_API_KEY` — секретный ключ для Web API
- `BACKEND_BASE_URL` — URL вашего backend (api-1.yaml)
- `BACKEND_TOKEN` — токен для backend API

**Для Control Panel** (опционально):
- `YOOMONEY_TOKEN`, `YOOMONEY_WALLET` — для продаж MTProxy
- `USE_REDIS=true` — включить Redis для кэширования (по умолчанию false, используется in-memory cache)

**Для Node Agent** (обязательные):
- `API_TOKEN` — секретный токен для доступа к API ноды
- `DOMAIN` — домен ноды (например, proxy.example.com)
- `INTERNAL_IP` — внутренний IP сервера

**Для Node Agent** (опционально):
- `MTPROTO_PORT` — порт MTProto (по умолчанию 443)
- `MT_PROXY_IMAGE` — образ MTProxy (по умолчанию telegrammessenger/proxy:latest)
- `WORKERS` — количество воркеров (по умолчанию 2)
- `ENABLE_SOCKS5` — включить SOCKS5 (false/true)

## Redis (опционально)

Redis можно использовать для кэширования в продакшене:

```bash
# В docker-compose.yml Redis уже настроен, но запускается только с профилем
docker compose --profile redis up -d

# Или установите USE_REDIS=true в .env и уберите profiles из redis service
```

По умолчанию используется in-memory cache (достаточно для большинства случаев).

