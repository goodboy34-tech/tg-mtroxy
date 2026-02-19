# Пути для Webhook'ов Remnawave

## Как сервис обрабатывает webhook'и

Сервис обрабатывает webhook'и по следующим путям:

### Доступные эндпоинты:

1. **`/api/remnawave/subscriptions/status`** (POST)
   - **Назначение**: Обновление статусов подписок
   - **Использование**: Основной эндпоинт для webhook'ов от Remnawave панели
   - **Тело запроса**: Массив объектов `{remnawaveSubscriptionId: string, status: 'active' | 'expired' | 'cancelled'}`
   - **Пример**: 
     ```json
     [
       {"remnawaveSubscriptionId": "sub_123", "status": "active"},
       {"remnawaveSubscriptionId": "sub_456", "status": "expired"}
     ]
     ```

2. **`/api/remnawave/users/sync`** (POST)
   - **Назначение**: Синхронизация пользователей и подписок
   - **Тело запроса**: `{telegramId?, remnawaveUserId?, remnawaveSubscriptionId, localSubscriptionId, status}`

3. **`/api/remnawave/users/by-link`** (POST)
   - **Назначение**: Синхронизация по ссылке подписки
   - **Тело запроса**: `{remnawaveSubscriptionLink, localSubscriptionId, status, telegramId?, remnawaveUserId?}`

4. **`/api/remnawave/authorize`** (POST)
   - **Назначение**: Авторизация пользователя и выдача MTProto доступа
   - **Тело запроса**: `{telegramId?, username?, shortUuid?, remnawaveSubscriptionId, localSubscriptionId}`

## Какой URL указывать в Remnawave панели?

### ✅ Правильно:

**Если используете HTTPS через Caddy:**
```
https://your-domain.com/api/remnawave/subscriptions/status
```

**Если используете HTTP напрямую:**
```
http://your-domain.com:8081/api/remnawave/subscriptions/status
```

### ❌ Неправильно:

```
https://your-domain.com/api/remnawave/          # Неполный путь
https://your-domain.com/webhook                  # Неправильный путь
http://your-domain.com:8081/                     # Неполный путь
```

## Важно:

1. **Полный путь обязателен** - нужно указывать `/api/remnawave/subscriptions/status`, а не просто `/api/remnawave/`

2. **Метод POST** - все webhook'и принимают только POST запросы

3. **Аутентификация** - все запросы должны содержать заголовок:
   - `x-api-key: <REMNAWAVE_API_KEY>` ИЛИ
   - `x-webhook-secret: <WEBHOOK_SECRET_HEADER>` (или другой кастомный заголовок)

4. **Content-Type** - запросы должны иметь заголовок `Content-Type: application/json`

## Пример настройки в Remnawave панели:

```
WEBHOOK_URL: https://your-domain.com/api/remnawave/subscriptions/status
WEBHOOK_SECRET_HEADER: your-secret-key-from-env
```

## Проверка работы:

```bash
# Проверка через curl
curl -X POST https://your-domain.com/api/remnawave/subscriptions/status \
  -H "Content-Type: application/json" \
  -H "x-api-key: your-secret-key" \
  -d '[{"remnawaveSubscriptionId": "test", "status": "active"}]'
```

## Логи для отладки:

```bash
# Просмотр логов webhook'ов
docker logs mtproxy-control -f | grep -i webhook
docker logs mtproxy-control -f | grep -i remnawave
```

