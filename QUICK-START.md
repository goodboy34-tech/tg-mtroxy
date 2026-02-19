# Quick Start Guide

## 1. Установка Control Panel

### Требования
- Ubuntu 24.04 или выше
- Docker и Docker Compose установлены
- Telegram Bot Token (получить у @BotFather)

### Шаги установки

```bash
# Клонируйте репозиторий
git clone https://github.com/goodboy34-tech/eeee.git
cd eeee

# Скопируйте пример конфигурации
cp ENV.example .env

# Отредактируйте .env файл
nano .env
```

**Минимальные настройки в `.env`:**
```bash
BOT_TOKEN=your_bot_token_here
ADMIN_IDS=123456789  # Ваш Telegram ID
REMNAWAVE_API_KEY=change-me-to-secure-key
WEB_API_KEY=change-me-to-secure-key
BACKEND_BASE_URL=https://your-backend.com
BACKEND_TOKEN=your-backend-token
```

**Запуск:**
```bash
./install-control.sh
```

Или вручную:
```bash
docker compose up -d
```

**Проверка:**
```bash
docker logs mtproxy-control
# Должны увидеть: "🌐 Remnawave API запущен на порту 8081"
# И: "🌐 Web API запущен на порту 8082"
```

## 2. Установка Node Agent

### На сервере с прокси

```bash
# Скопируйте ENV.example
cp ENV.example .env

# Отредактируйте .env
nano .env
```

**Минимальные настройки:**
```bash
API_TOKEN=change-me-to-secure-token
DOMAIN=proxy.example.com
INTERNAL_IP=10.0.0.1  # Внутренний IP сервера
MTPROTO_PORT=443
WORKERS=2
MT_PROXY_IMAGE=telegrammessenger/proxy:latest
ENABLE_SOCKS5=false
```

**Запуск:**
```bash
./install-node.sh
```

Или вручную:
```bash
docker compose -f docker-compose.node.yml up -d
```

**Проверка:**
```bash
docker logs mtproxy-node-agent
# Должны увидеть: "Node Agent API запущен на порту 8080"
```

## 3. Добавление ноды в Control Panel

1. Откройте Telegram бота (токен из `.env`)
2. Отправьте команду `/add_node`
3. Заполните данные:
   - **Name**: Имя ноды (например, "US-1")
   - **Domain**: Домен ноды (например, "proxy.example.com")
   - **IP**: IP адрес сервера
   - **API URL**: `http://IP_НОДЫ:8080` (порт node-agent)
   - **API Token**: Токен из `.env` ноды (`API_TOKEN`)

4. Нода появится в списке `/nodes`

## 4. Создание подписки

1. В боте отправьте `/create_subscription Название`
2. Выберите ноды для подписки
3. Подписка будет создана и получит уникальный ID

## 5. Интеграция с Remnawave

### Настройка backend

Убедитесь, что ваш backend (api-1.yaml) доступен и имеет эндпоинты:
- `GET /api/users/by-telegram-id/{telegramId}`
- `GET /api/users/{uuid}/accessible-nodes`

### Выдача MTProto ссылок пользователям

**Через Remnawave API:**
```bash
curl -X POST http://control-panel:8081/api/remnawave/authorize \
  -H "X-API-KEY: your-remnawave-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "telegramId": 123456789,
    "remnawaveSubscriptionId": "sub-123",
    "localSubscriptionId": 1
  }'
```

**Через Web API (для веб-приложения):**
```bash
curl -X POST http://control-panel:8082/api/web/check-subscription \
  -H "X-API-KEY: your-web-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "telegramId": 123456789,
    "remnawaveSubscriptionId": "sub-123"
  }'
```

## 6. Проверка работы

### В Telegram боте

- `/stats` — общая статистика
- `/health` — здоровье нод
- `/nodes` — список нод
- `/subscriptions` — список подписок

### Проверка API

```bash
# Health check node-agent
curl http://node-ip:8080/health \
  -H "Authorization: Bearer your-api-token"

# Статистика ноды
curl http://node-ip:8080/stats \
  -H "Authorization: Bearer your-api-token"
```

## 7. Управление

### Остановка/запуск Control Panel

```bash
./scripts/manage-control.sh stop
./scripts/manage-control.sh start
./scripts/manage-control.sh restart
```

### Остановка/запуск Node Agent

```bash
./scripts/manage-node.sh stop
./scripts/manage-node.sh start
./scripts/manage-node.sh restart
```

### Просмотр логов

```bash
# Control Panel
docker logs -f mtproxy-control

# Node Agent
docker logs -f mtproxy-node-agent
```

## Troubleshooting

### Бот не отвечает

1. Проверьте `BOT_TOKEN` в `.env`
2. Проверьте логи: `docker logs mtproxy-control`
3. Убедитесь, что ваш Telegram ID в `ADMIN_IDS`

### Нода не подключается

1. Проверьте доступность API ноды: `curl http://node-ip:8080/health`
2. Проверьте `API_TOKEN` в `.env` ноды
3. Проверьте firewall (порт 8080 должен быть открыт)

### MTProto не работает

1. Проверьте статус контейнера: `docker ps | grep mtproxy`
2. Проверьте логи: `docker logs mtproxy`
3. Убедитесь, что порт 443 открыт в firewall

## Следующие шаги

- Прочитайте [README.md](./README.md) для полной документации
- Изучите [docs/PERFORMANCE.md](./docs/PERFORMANCE.md) для оптимизации
- Настройте автоматические бэкапы базы данных
