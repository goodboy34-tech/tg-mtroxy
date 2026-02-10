# Установка ноды на том же сервере с панелью управления

Этот гайд объясняет как развернуть ноду MTProxy на том же сервере, где уже работает панель управления.

## Почему это работает?

Нода использует нестандартные порты, чтобы избежать конфликтов:

| Сервис | Стандартный порт | Порт локальной ноды |
|--------|------------------|---------------------|
| MTProto | 443 | 8443 |
| SOCKS5 | 1080 | 9080 |
| API | 8080 | 9090 |

## Требования

- Панель управления уже установлена и работает
- Docker и Docker Compose установлены
- Порты 8443, 9080, 9090 открыты в firewall

## Установка

### 1. Создайте API токен для ноды

В боте выполните команду `/add_node` и следуйте инструкциям. Получите:
- `NODE_TOKEN` - токен для аутентификации ноды
- `NODE_ID` - ID ноды в системе

### 2. Создайте .env файл для локальной ноды

```bash
cd /root/eeee
cat > .env.node << 'EOF'
# Токен для подключения к панели управления
API_TOKEN=your_node_token_here

# IP сервера (внешний)
DOMAIN=your_server_ip

# Внутренний IP (если используется NAT, иначе оставьте пустым)
INTERNAL_IP=

# Количество воркеров
WORKERS=2

# Секреты и параметры (генерируются автоматически)
SECRET=
SECRET_COUNT=1
TAG=
EOF
```

### 3. Запустите локальную ноду

```bash
# Запуск ноды на том же сервере
docker compose -f docker-compose.node.yml --env-file .env.node up -d

# Проверка статуса
docker compose -f docker-compose.node.yml ps

# Проверка логов
docker compose -f docker-compose.node.yml logs -f
```

### 4. Проверьте работу

```bash
# Проверьте что все контейнеры запущены
docker ps | grep mtproxy

# Должны быть:
# - mtproxy-control (панель управления)
# - mtproxy-node-local (API ноды)
# - mtproxy-local (MTProto прокси)
# - mtproxy-socks5-local (SOCKS5 прокси)
```

### 5. Добавьте ноду в панель

В боте:
1. `/nodes` - посмотрите список нод
2. Локальная нода должна появиться автоматически после подключения
3. Проверьте статус: `/node <id>`

## Управление

### Остановка локальной ноды

```bash
docker compose -f docker-compose.node.yml down
```

### Перезапуск локальной ноды

```bash
docker compose -f docker-compose.node.yml restart
```

### Обновление локальной ноды

```bash
# Остановить
docker compose -f docker-compose.node.yml down

# Обновить код из git
git pull

# Пересобрать и запустить
docker compose -f docker-compose.node.yml build --no-cache
docker compose -f docker-compose.node.yml up -d
```

### Логи

```bash
# Все логи
docker compose -f docker-compose.node.yml logs -f

# Логи конкретного сервиса
docker compose -f docker-compose.node.yml logs -f node-agent
docker compose -f docker-compose.node.yml logs -f mtproto-local
docker compose -f docker-compose.node.yml logs -f socks5-local
```

## Получение ссылок для подключения

После запуска локальной ноды, MTProto прокси сгенерирует секреты и ссылки:

```bash
# Посмотрите логи MTProto контейнера
docker logs mtproxy-local | grep "t.me/proxy"

# Или через docker compose
docker compose -f docker-compose.node.yml logs mtproto-local | grep "t.me/proxy"
```

Вы увидите что-то вроде:
```
t.me/proxy?server=YOUR_IP&port=8443&secret=SECRET
```

## Firewall

Откройте порты на сервере:

```bash
# UFW (Ubuntu/Debian)
ufw allow 8443/tcp comment "MTProto Local Node"
ufw allow 9080/tcp comment "SOCKS5 Local Node"
ufw allow 9090/tcp comment "Node Agent API"
ufw reload

# FirewallD (CentOS/RHEL)
firewall-cmd --permanent --add-port=8443/tcp
firewall-cmd --permanent --add-port=9080/tcp
firewall-cmd --permanent --add-port=9090/tcp
firewall-cmd --reload

# iptables
iptables -A INPUT -p tcp --dport 8443 -j ACCEPT
iptables -A INPUT -p tcp --dport 9080 -j ACCEPT
iptables -A INPUT -p tcp --dport 9090 -j ACCEPT
iptables-save > /etc/iptables/rules.v4
```

## Проверка подключения

### MTProto прокси (порт 8443)

```bash
# Проверка порта
nc -zv YOUR_SERVER_IP 8443

# Проверка через telnet
telnet YOUR_SERVER_IP 8443
```

### SOCKS5 прокси (порт 9080)

```bash
# Проверка без авторизации
curl -x socks5://YOUR_SERVER_IP:9080 https://ifconfig.me

# С авторизацией (если настроена в 3proxy.cfg)
curl -x socks5://user:pass@YOUR_SERVER_IP:9080 https://ifconfig.me
```

### Node Agent API (порт 9090)

```bash
# Проверка health endpoint
curl http://YOUR_SERVER_IP:9090/health

# Должно вернуть:
# {"status":"ok","timestamp":"..."}
```

## Troubleshooting

### Нода не появляется в панели

1. Проверьте что API токен правильный:
   ```bash
   cat .env.node | grep API_TOKEN
   ```

2. Проверьте логи node-agent:
   ```bash
   docker compose -f docker-compose.node.yml logs node-agent
   ```

3. Проверьте что панель управления работает:
   ```bash
   docker ps | grep mtproxy-control
   ```

### Ошибка "port already in use"

Проверьте какие порты заняты:

```bash
# Проверка занятых портов
netstat -tlnp | grep -E '8443|9080|9090'

# Или через ss
ss -tlnp | grep -E '8443|9080|9090'
```

Если порты заняты, измените их в `docker-compose.node.yml`:
- Найдите секцию `ports:`
- Измените левую часть (внешний порт): `"NEW_PORT:INTERNAL_PORT"`

### Клиенты не могут подключиться к MTProto

1. Проверьте что порт открыт в firewall
2. Проверьте что контейнер запущен:
   ```bash
   docker ps | grep mtproxy-local
   ```
3. Проверьте логи:
   ```bash
   docker logs mtproxy-local
   ```
4. Проверьте секрет:
   ```bash
   docker logs mtproxy-local | grep "secret"
   ```

### Network not found

Если видите ошибку `network mtproxy-network declared as external, but could not be found`:

```bash
# Создайте сеть вручную
docker network create mtproxy-network

# Или измените в docker-compose.node.yml:
# networks:
#   mtproxy-network:
#     driver: bridge  # вместо external: true
```

## Полное удаление локальной ноды

```bash
# Остановить и удалить контейнеры
docker compose -f docker-compose.node.yml down -v

# Удалить данные
rm -rf ./node-data

# Удалить .env файл
rm .env.node

# В боте удалите ноду через /remove_node <id>
```
