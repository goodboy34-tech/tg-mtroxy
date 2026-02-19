# Настройка Webhook'ов Remnawave

## URL для указания в Remnawave панели

Remnawave панель может отправлять webhook'и на следующие эндпоинты:

### Основные эндпоинты:

1. **`/api/remnawave/subscriptions/status`** — для обновления статусов подписок (используется чаще всего)
2. **`/api/remnawave/users/sync`** — для синхронизации пользователей
3. **`/api/remnawave/users/by-link`** — для синхронизации по ссылке подписки
4. **`/api/remnawave/authorize`** — для авторизации пользователя

### Формат URL:

#### Если HTTPS не настроен (только HTTP):

```
http://your-domain.com:8081/api/remnawave/subscriptions/status
```

**Важно:** 
- Замените `your-domain.com` на ваш домен или IP адрес
- Порт `8081` — это порт по умолчанию для Remnawave API (можно изменить через `REMNAWAVE_API_PORT` в `.env`)
- Убедитесь, что порт `8081` открыт в файрволе и доступен из интернета

#### Если HTTPS настроен через reverse proxy (nginx):

```
https://your-domain.com/api/remnawave/subscriptions/status
```

В этом случае nginx должен проксировать запросы на `http://localhost:8081` (или `http://mtproxy-control:8081` если используется Docker).

### Пример конфигурации nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location /api/remnawave/ {
        proxy_pass http://localhost:8081;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Передаем заголовки для аутентификации
        proxy_set_header x-api-key $http_x_api_key;
        proxy_set_header x-webhook-secret $http_x_webhook_secret;
    }
}
```

## Настройка аутентификации

В Remnawave панели нужно указать:

1. **WEBHOOK_URL** — полный URL эндпоинта (см. выше)
2. **WEBHOOK_SECRET_HEADER** — секретный ключ для аутентификации

### Переменные окружения в `.env`:

```env
# Для аутентификации через заголовок x-api-key
REMNAWAVE_API_KEY=your-secret-key-here

# ИЛИ для аутентификации через кастомный заголовок
WEBHOOK_SECRET_HEADER=your-secret-header-value
```

**Важно:** Значение `WEBHOOK_SECRET_HEADER` в `.env` должно совпадать со значением `WEBHOOK_SECRET_HEADER` в Remnawave панели.

## Проверка работы webhook'ов

После настройки можно проверить работу webhook'ов:

1. Проверьте логи контейнера:
   ```bash
   docker logs mtproxy-control -f
   ```

2. Проверьте, что сервер отвечает:
   ```bash
   curl -X POST http://your-domain.com:8081/api/remnawave/subscriptions/status \
     -H "Content-Type: application/json" \
     -H "x-api-key: your-secret-key" \
     -d '[{"remnawaveSubscriptionId": "test", "status": "active"}]'
   ```

3. Если используется HTTPS через nginx:
   ```bash
   curl -X POST https://your-domain.com/api/remnawave/subscriptions/status \
     -H "Content-Type: application/json" \
     -H "x-api-key: your-secret-key" \
     -d '[{"remnawaveSubscriptionId": "test", "status": "active"}]'
   ```

## Частые проблемы

### Проблема: Webhook'и не доходят до сервера

**Решение:**
1. Убедитесь, что порт `8081` открыт в файрволе:
   ```bash
   sudo ufw allow 8081/tcp
   ```

2. Проверьте, что контейнер запущен:
   ```bash
   docker ps | grep mtproxy-control
   ```

3. Проверьте логи на наличие ошибок:
   ```bash
   docker logs mtproxy-control
   ```

### Проблема: Ошибка 401 Unauthorized

**Решение:**
1. Убедитесь, что `REMNAWAVE_API_KEY` или `WEBHOOK_SECRET_HEADER` правильно указаны в `.env`
2. Проверьте, что Remnawave панель отправляет правильный заголовок аутентификации
3. Проверьте логи для деталей ошибки

### Проблема: HTTPS не работает

**Решение:**
1. Настройте reverse proxy (nginx) для HTTPS
2. Или используйте HTTP с указанием порта: `http://your-domain.com:8081/api/remnawave/subscriptions/status`

