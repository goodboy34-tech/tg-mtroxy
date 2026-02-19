## Контракт интеграции: ваш backend (api-1.yaml) → tg-mtproxy control-panel

### Идентификация пользователя (в порядке приоритета)

Ваш backend поддерживает поиск пользователя по:
- `GET /api/users/by-telegram-id/{telegramId}`
- `GET /api/users/by-username/{username}`
- `GET /api/users/by-short-uuid/{shortUuid}`

### Проверка активности подписки Remnawave

Критерий: у пользователя есть доступные ноды:
- `GET /api/users/{uuid}/accessible-nodes`

Правило:
- если список нод пустой → **подписки нет / доступа нет** → MTProto нужно отключить;
- если список нод не пустой → **доступ есть** → MTProto можно выдавать/продлевать.

### Вызов control-panel (этот проект)

#### Авторизация / выдача MTProto

`POST /api/remnawave/authorize`

Заголовок: `X-API-KEY: <REMNAWAVE_API_KEY>`

Тело:
```json
{
  "telegramId": 123456789,
  "username": "optional_username",
  "shortUuid": "optional_short_uuid",
  "remnawaveSubscriptionId": "pageId_or_shortUuid_or_any_string_id",
  "localSubscriptionId": 1
}
```

Ответ:
- `status=active` и `links[]` → пользователю выдавать эти MTProto-ссылки
- `status=expired` и `links=[]` → доступ снят

### Замечания

- В текущей реализации выдача **персонального** MTProto требует `telegramId`, чтобы можно было точечно удалять секреты при истечении подписки.
- Remnawave Python SDK может использоваться в вашем backend для дополнительных данных, но для решения “есть подписка/нет подписки” достаточно `accessible-nodes`.


