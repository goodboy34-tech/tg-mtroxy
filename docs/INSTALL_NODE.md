# Установка MTProxy Node

## Быстрая установка (рекомендуется)

### Шаг 1: Добавьте ноду через бота

1. Откройте бота в Telegram
2. Отправьте команду `/add_node`
3. Отправьте данные ноды в формате:

```
name: My Node 1
domain: YOUR_SERVER_IP
ip: YOUR_SERVER_IP
api_url: http://YOUR_SERVER_IP:9090
mtproto_port: 8443
socks5_port: 9080
workers: 2
cpu_cores: 2
ram_mb: 2048
```

4. Бот выдаст **API токен** - сохраните его!

### Шаг 2: Запустите скрипт на сервере

```bash
curl -fsSL https://raw.githubusercontent.com/goodboy34-tech/eeee/master/install-node.sh | sudo bash
```

Скрипт:
- Установит Docker и Docker Compose (если нет)
- Определит IP адрес сервера
- Запросит API токен от бота
- Настроит firewall
- Запустит MTProxy, SOCKS5 и Node Agent

### Шаг 3: Проверьте работу

```bash
# Статус контейнеров
cd /opt/mtproxy-node
docker compose -f docker-compose.node.yml ps

# Логи
docker compose -f docker-compose.node.yml logs -f

# Получить MTProxy ссылку
docker logs mtproxy-local | grep "t.me/proxy"
```

---

## Ручная установка

### 1. Установите Docker

```bash
curl -fsSL https://get.docker.com | sudo bash
sudo systemctl enable docker
sudo systemctl start docker
```

### 2. Клонируйте репозиторий

```bash
sudo mkdir -p /opt/mtproxy-node
cd /opt/mtproxy-node
sudo git clone https://github.com/goodboy34-tech/eeee.git .
```

### 3. Создайте .env.node файл

Сначала добавьте ноду через бота `/add_node` и получите API токен.

```bash
cat > .env.node <<EOF
# API токен от бота
API_TOKEN=your_api_token_here

# IP и домен
DOMAIN=YOUR_SERVER_IP
INTERNAL_IP=

# Воркеры
WORKERS=2

# Автогенерация
SECRET=
SECRET_COUNT=1
TAG=
EOF
```

### 4. Настройте firewall

**UFW (Ubuntu/Debian):**
```bash
sudo ufw allow 8443/tcp comment "MTProxy Node"
sudo ufw allow 9080/tcp comment "SOCKS5 Node"  
sudo ufw allow 9090/tcp comment "Node API"
```

**FirewallD (CentOS/RHEL):**
```bash
sudo firewall-cmd --permanent --add-port=8443/tcp
sudo firewall-cmd --permanent --add-port=9080/tcp
sudo firewall-cmd --permanent --add-port=9090/tcp
sudo firewall-cmd --reload
```

**iptables:**
```bash
sudo iptables -A INPUT -p tcp --dport 8443 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 9080 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 9090 -j ACCEPT
sudo iptables-save > /etc/iptables/rules.v4
```

### 5. Запустите контейнеры

```bash
docker compose -f docker-compose.node.yml --env-file .env.node up -d
```

### 6. Проверьте статус

```bash
# Статус
docker compose -f docker-compose.node.yml ps

# Логи
docker compose -f docker-compose.node.yml logs -f

# MTProxy ссылка
docker logs mtproxy-local | grep "t.me/proxy"
```

---

## Управление нодой

### Остановка

```bash
cd /opt/mtproxy-node
docker compose -f docker-compose.node.yml down
```

### Перезапуск

```bash
docker compose -f docker-compose.node.yml restart
```

### Обновление

```bash
cd /opt/mtproxy-node
git pull
docker compose -f docker-compose.node.yml down
docker compose -f docker-compose.node.yml build --no-cache
docker compose -f docker-compose.node.yml up -d
```

### Просмотр логов

```bash
# Все логи
docker compose -f docker-compose.node.yml logs -f

# Конкретный сервис
docker compose -f docker-compose.node.yml logs -f node-agent
docker compose -f docker-compose.node.yml logs -f mtproxy-local
docker compose -f docker-compose.node.yml logs -f socks5-local
```

### Проверка ресурсов

```bash
docker stats
```

---

## Troubleshooting

### Нода не подключается к Control Panel

1. Проверьте API токен в `.env.node`
2. Проверьте что API порт 9090 открыт
3. Проверьте логи node-agent:
   ```bash
   docker compose -f docker-compose.node.yml logs node-agent
   ```

### MTProxy не принимает подключения

1. Проверьте что порт 8443 открыт в firewall
2. Проверьте логи MTProxy:
   ```bash
   docker logs mtproxy-local
   ```
3. Убедитесь что секрет корректный:
   ```bash
   docker logs mtproxy-local | grep secret
   ```

### Контейнеры не запускаются

1. Проверьте логи:
   ```bash
   docker compose -f docker-compose.node.yml logs
   ```
2. Проверьте занятость портов:
   ```bash
   netstat -tlnp | grep -E '8443|9080|9090'
   ```
3. Измените порты в docker-compose.node.yml если заняты

### Высокое использование CPU/RAM

1. Уменьшите количество воркеров в `.env.node`
2. Перезапустите:
   ```bash
   docker compose -f docker-compose.node.yml restart
   ```

---

## Удаление ноды

```bash
cd /opt/mtproxy-node

# Остановить и удалить контейнеры
docker compose -f docker-compose.node.yml down -v

# Удалить директорию
cd ..
rm -rf /opt/mtproxy-node

# В боте удалите ноду через /remove_node <id>
```

---

## Полезные команды

```bash
# Проверить версию Docker
docker --version

# Проверить запущенные контейнеры
docker ps

# Проверить все контейнеры (включая остановленные)
docker ps -a

# Очистить неиспользуемые образы
docker system prune -a

# Резервное копирование .env.node
cp .env.node .env.node.backup

# Восстановление из бэкапа
cp .env.node.backup .env.node
```
