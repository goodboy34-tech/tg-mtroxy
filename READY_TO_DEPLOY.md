# ✅ Все обновления применены!

## Что сделано:

### 1. ✅ Ограничение логов до 30MB
- Все контейнеры (бот, node-agent, mtproxy, socks5)
- `max-size: 30m`, `max-file: 1`
- В `docker-compose.yml` и `docker-compose.node.yml`

### 2. ✅ Поддержка AD_TAG
- Новая колонка `ad_tag` в таблице `nodes`
- Автоматическая миграция БД
- Переменная окружения `AD_TAG` в node-agent
- Передаётся в MTProto как `TAG`

### 3. ✅ Улучшена статистика в боте
- Теперь показывает если нет данных
- Добавлен сетевой трафик (↓in/↑out MB)
- Средние значения CPU/RAM по всем нодам
- Лучшее форматирование с эмоджи

## 📋 Как обновить на сервере:

### Control Panel (бот):
```bash
cd /opt/mtproxy-control
git pull
docker compose build
docker compose down && docker compose up -d

# Проверить
docker logs -f mtproxy-control
```

### Node:
```bash
cd /opt/mtproxy-node

# Скачать новый код
curl -L https://github.com/goodboy34-tech/eeee/archive/refs/heads/master.tar.gz -o update.tar.gz
tar -xzf update.tar.gz
cp -r eeee-master/node-agent/* ./node-agent/
cp eeee-master/docker-compose.node.yml ./
rm -rf eeee-master update.tar.gz

# Пересобрать
docker compose -f docker-compose.node.yml build
docker compose -f docker-compose.node.yml down && docker compose -f docker-compose.node.yml up -d

# Проверить
docker logs -f mtproxy-node-agent
```

## 🔧 Настройка AD_TAG (опционально):

### В .env файле ноды:
```bash
# node-agent/.env
AD_TAG=dd1234567890abcdef
```

### Или в docker-compose.node.yml:
```yaml
node-agent:
  environment:
    - AD_TAG=dd1234567890abcdef
```

Перезапустить после изменения:
```bash
docker compose -f docker-compose.node.yml restart node-agent
```

## 📊 Проверка статистики:

В боте:
```
/stats - общая статистика
/health - здоровье нод
```

Если нет данных:
- Подождите 5 минут (cron каждые 5 минут)
- Проверьте что ноды доступны: `/health`
- Проверьте логи: `docker logs mtproxy-control`

## 🎯 Что показывает статистика:

```
📊 Общая статистика

Нод активно: 2
Статистика от: 2 нод

🖥 Node-Moscow
   MTProto: 5/100 подключений
   SOCKS5: 2 подключений
   CPU: 15.3% | RAM: 42.1%
   Network: ↓125.5MB ↑89.2MB

🖥 Node-London
   MTProto: 8/100 подключений
   SOCKS5: 3 подключений
   CPU: 18.7% | RAM: 38.5%
   Network: ↓98.3MB ↑71.4MB

📈 Итого по всем нодам:
MTProto: 13/200
SOCKS5: 5
Средний CPU: 17.0%
Средний RAM: 40.3%
Суммарный трафик: ↓223.8MB ↑160.6MB
```

## ⚠️ Если статистика пустая:

1. **Только что добавили ноду?**
   - Подождите 5 минут
   - Cron собирает данные каждые 5 минут

2. **Нода офлайн?**
   - Проверьте `/health`
   - Проверьте доступность API: `curl http://node-ip:3000/health -H "Authorization: Bearer YOUR_TOKEN"`

3. **API не отвечает?**
   - Проверьте node-agent запущен: `docker ps | grep node-agent`
   - Проверьте логи: `docker logs mtproxy-node-agent`

4. **БД проблемы?**
   - Проверьте файл БД: `ls -lh /opt/mtproxy-control/data/proxy.db`
   - Должен быть > 0 байт

## 📝 Commits:
- a8de9f3: Add logging limits, AD_TAG support
- 121fc7b: Improve stats command

---

**Всё готово! Обновите серверы и проверьте статистику через 5 минут.**
