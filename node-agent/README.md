# 🚀 MTProxy Node Agent

Агент для развертывания MTProxy и SOCKS5 прокси на серверах. Управляется через Control Panel.

## 📋 Что включено

- **MTProxy** - Telegram MTProto прокси (порт 443)
  - Поддержка Fake-TLS (dd префикс) для обхода DPI
  - До 60,000 соединений на воркер
  - Настраиваемое количество воркеров (1-16)

- **SOCKS5 Proxy** - С авторизацией через 3proxy (порт 1080)
  - Поддержка username/password
  - Генерация Telegram deeplinks
  - До 4000+ одновременных пользователей

- **Node API** - HTTP API для управления (порт 3001)
  - Добавление/удаление секретов MTProxy
  - Добавление/удаление SOCKS5 аккаунтов
  - Изменение количества воркеров
  - Получение статистики и логов
  - Health checks

## 🚀 Быстрая установка

### Требования

- **OS**: Ubuntu 20.04/22.04 или Debian 10/11
- **RAM**: минимум 512MB (рекомендуется 1GB+)
- **CPU**: 1 ядро (рекомендуется 2+)
- **Порты**: 443, 1080, 3001 должны быть свободны
- **Root доступ**

### Установка

```bash
# 1. Подключитесь к серверу
ssh root@your-server-ip

# 2. Клонируйте репозиторий
git clone https://github.com/yourusername/tg-mtproxy.git
cd tg-mtproxy/node-agent

# 3. Запустите установку
sudo bash scripts/install.sh
```

### Что делает скрипт установки

1. ✅ Устанавливает Docker и Docker Compose (если нужно)
2. ✅ Определяет внешний IP автоматически
3. ✅ Генерирует уникальный API ключ (32 байта hex)
4. ✅ Генерирует MTProxy секрет (16 байт hex)
5. ✅ Настраивает .env файл
6. ✅ Настраивает UFW firewall
7. ✅ Собирает и запускает Docker контейнеры
8. ✅ Выводит команду для добавления ноды в Control Panel

### Пример вывода

```
✅ Установка завершена!

📊 Проверка статуса:
NAME                COMMAND             STATUS
node-agent          "npm start"         Up 5 seconds
mtproxy             "./mtproto-proxy"   Up 5 seconds
socks5              "3proxy"            Up 5 seconds

🔗 API доступен по адресу:
  https://1.2.3.4:3001

🔑 Для добавления ноды в Control Panel используйте:
  /add_node Node1 proxy.example.com https://1.2.3.4:3001 a1b2c3d4e5f6...

🎉 Node Agent запущен!
```

## ⚙️ Конфигурация

### Переменные окружения (.env)

```bash
# Идентификация ноды
NODE_NAME=Node1                    # Имя ноды
DOMAIN=proxy.example.com           # Домен для клиентов
API_KEY=your_secret_key_here       # API ключ (генерируется автоматически)

# Порты
MTPROTO_PORT=443                   # MTProxy порт
SOCKS5_PORT=1080                   # SOCKS5 порт
API_PORT=3001                      # Node API порт

# MTProxy настройки
WORKERS=4                          # Количество воркеров (1-16)
SECRET=your_mtproxy_secret         # Базовый секрет (генерируется автоматически)

# Сеть
NAT=                               # Внешний IP (если за NAT)

# Опционально: Fake-TLS
FAKE_TLS_DOMAIN=www.google.com     # Домен для имитации
```

### Генерация ключей вручную

```bash
# API ключ (32 байта)
openssl rand -hex 32

# MTProxy секрет (16 байт)
openssl rand -hex 16
```

### Настройка воркеров

**Рекомендации**:
- **1-2 CPU**: 2-4 воркера
- **4 CPU**: 4-8 воркеров
- **8+ CPU**: 8-16 воркеров

**Расчет соединений**:
```
Max соединений = WORKERS × 60,000
4 воркера = 240,000 соединений
```

## 🔗 Добавление ноды в Control Panel

После установки добавьте ноду через Telegram бота:

```
/add_node Node1 proxy.example.com https://1.2.3.4:3001 YOUR_API_KEY
```

Где:
- `Node1` - имя ноды (из .env)
- `proxy.example.com` - домен (из .env)
- `https://1.2.3.4:3001` - URL Node API
- `YOUR_API_KEY` - ключ, который вывел скрипт установки

## 📊 Мониторинг

### Проверка статуса

```bash
# Статус всех контейнеров
docker-compose ps

# Просмотр логов
docker-compose logs -f

# Логи конкретного сервиса
docker-compose logs -f mtproxy
docker-compose logs -f socks5
docker-compose logs -f node-agent
```

### Проверка API

```bash
# Health check
curl -k https://localhost:3001/health

# Статистика MTProxy
curl -k https://localhost:3001/mtproto/stats \
  -H "X-API-Key: YOUR_API_KEY"

# Статистика SOCKS5
curl -k https://localhost:3001/socks5/stats \
  -H "X-API-Key: YOUR_API_KEY"
```

### Мониторинг ресурсов

```bash
# Использование CPU и RAM
docker stats

# Использование диска
df -h

# Сетевые соединения
netstat -tupln | grep -E '443|1080|3001'
```

## 🔧 Обслуживание

### Обновление

```bash
cd node-agent
git pull
docker-compose down
docker-compose up -d --build
```

### Перезапуск

```bash
# Все сервисы
docker-compose restart

# Конкретный сервис
docker-compose restart mtproxy
docker-compose restart socks5
docker-compose restart node-agent
```

### Изменение воркеров

Через Control Panel:
```
/set_workers <node_id> <count>
```

Или вручную:
```bash
# Изменить в .env
nano .env
# WORKERS=8

# Перезапустить
docker-compose restart mtproxy
```

### Backup конфигурации

```bash
# Создать backup
cp .env .env.backup-$(date +%Y%m%d)

# Восстановить
cp .env.backup-20260210 .env
docker-compose restart
```

## 🔐 Безопасность

### SSL сертификаты

Node API использует самоподписанные сертификаты. Для production:

```bash
# Установите certbot
apt install certbot

# Получите сертификат
certbot certonly --standalone -d api.yourdomain.com

# Обновите docker-compose.yml для использования сертификатов Let's Encrypt
```

### API Key

```bash
# Посмотреть текущий
cat .env | grep API_KEY

# Сгенерировать новый
NEW_KEY=$(openssl rand -hex 32)
sed -i "s/API_KEY=.*/API_KEY=$NEW_KEY/" .env

# Перезапустить
docker-compose restart

# Обновить в Control Panel через /node <id>
```

### Firewall

```bash
# Проверить правила
ufw status

# Закрыть порт API для всех кроме Control Panel
ufw delete allow 3001/tcp
ufw allow from CONTROL_PANEL_IP to any port 3001 proto tcp

# Перезагрузить
ufw reload
```

## 🗑️ Удаление

```bash
cd node-agent
sudo bash scripts/uninstall.sh
```

Скрипт удаления:
- ✅ Останавливает все контейнеры
- ✅ Удаляет Docker образы
- ✅ Удаляет правила Firewall
- ✅ Удаляет файлы проекта
- ✅ Опционально сохраняет .env в backup

## 📡 API Reference

### Endpoints

#### Health Check
```bash
GET /health
Response: { status: "ok", uptime: 12345, ... }
```

#### MTProto - Добавить секрет
```bash
POST /mtproto/secrets
Headers: X-API-Key: YOUR_KEY
Body: { secret: "dd1234...", isFakeTls: true }
Response: { success: true }
```

#### MTProto - Удалить секрет
```bash
DELETE /mtproto/secrets/:secret
Headers: X-API-Key: YOUR_KEY
Response: { success: true }
```

#### MTProto - Изменить воркеры
```bash
POST /mtproto/workers
Headers: X-API-Key: YOUR_KEY
Body: { workers: 8 }
Response: { success: true }
```

#### SOCKS5 - Добавить аккаунт
```bash
POST /socks5/accounts
Headers: X-API-Key: YOUR_KEY
Body: { username: "user1", password: "pass123" }
Response: { success: true }
```

#### SOCKS5 - Удалить аккаунт
```bash
DELETE /socks5/accounts/:username
Headers: X-API-Key: YOUR_KEY
Response: { success: true }
```

#### Логи
```bash
GET /logs?lines=100
Headers: X-API-Key: YOUR_KEY
Response: { mtproxy: "...", socks5: "...", agent: "..." }
```

## ❓ Troubleshooting

### Порты заняты

```bash
# Проверить что занимает порт
lsof -i :443
lsof -i :1080
lsof -i :3001

# Остановить процесс
kill -9 PID

# Или изменить порты в .env и docker-compose.yml
```

### MTProxy не запускается

```bash
# Проверить логи
docker-compose logs mtproxy

# Проверить конфигурацию
docker exec mtproxy cat /data/config

# Пересоздать контейнер
docker-compose up -d --force-recreate mtproxy
```

### SOCKS5 не работает

```bash
# Проверить логи
docker-compose logs socks5

# Проверить конфигурацию
docker exec socks5 cat /etc/3proxy/3proxy.cfg

# Тест подключения
curl -x socks5://username:password@localhost:1080 https://ifconfig.me
```

### API недоступен

```bash
# Проверить статус
docker-compose ps node-agent

# Проверить порт
netstat -tupln | grep 3001

# Проверить firewall
ufw status | grep 3001

# Тест локально
curl -k https://localhost:3001/health
```

### Высокая нагрузка

```bash
# Проверить статистику
docker stats

# Увеличить воркеры через Control Panel
/set_workers <node_id> 8

# Или добавить еще одну ноду
```

## 📚 Дополнительные материалы

- [Control Panel README](../control-panel/README.md)
- [MTProto Proxy GitHub](https://github.com/TelegramMessenger/MTProxy)
- [3proxy Documentation](https://3proxy.org/)
- [Docker Documentation](https://docs.docker.com/)

## 🤝 Поддержка

При возникновении проблем:
1. Проверьте логи: `docker-compose logs -f`
2. Проверьте .env файл
3. Проверьте firewall: `ufw status`
4. Проверьте порты: `netstat -tupln`
5. Создайте issue на GitHub

---

Сделано с ❤️ для обхода блокировок Telegram
