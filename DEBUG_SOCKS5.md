# Диагностика SOCKS5 - Нет коннекта

## Лог показывает:
```
[SOCKS5] Updating GOST config with 2 accounts
```

Это значит node-agent работает! Но нет подключения. Проверяем:

## 1. Контейнер запущен?

```bash
docker ps | grep socks5
```

**Ожидаем увидеть:**
```
mtproxy-socks5   ginuerzh/gost   Up   0.0.0.0:1080->1080/tcp
```

**Если контейнера нет** - значит он не создался. Смотрим ошибки:
```bash
docker logs mtproxy-node-agent | grep -i socks5
```

## 2. Проверить команду запуска

```bash
docker inspect mtproxy-socks5 | grep -A 10 "Args"
```

**Должно быть:**
```json
"Args": [
    "-L=socks5://user1:pass1,user2:pass2@:1080"
]
```

## 3. Проверить порт открыт

```bash
# Внутри контейнера
docker exec mtproxy-socks5 netstat -tulpn | grep 1080

# На хосте
netstat -tulpn | grep 1080
```

**Ожидаем:**
```
tcp6  0  0  :::1080  :::*  LISTEN  -
```

## 4. Проверить подключение локально на сервере

```bash
# Простой тест
curl -x socks5://user1:pass1@localhost:1080 https://ifconfig.me

# Должен вернуть IP сервера
```

**Если ошибка:**
- `Connection refused` - контейнер не запущен или порт не пробросан
- `Authentication failed` - неправильный логин/пароль
- `Timeout` - firewall блокирует

## 5. Проверить логи GOST

```bash
docker logs mtproxy-socks5
```

**Должно быть:**
```
gost -L=socks5://user1:pass1,user2:pass2@:1080
```

## 6. Проверить firewall

```bash
# UFW
sudo ufw status | grep 1080

# iptables
sudo iptables -L -n | grep 1080
```

**Должно быть:**
```
1080/tcp   ALLOW   Anywhere
```

## 7. Проверить accounts в node-agent

```bash
cat /root/mtproxy/node-agent/data/socks5-users.json
```

**Должно быть:**
```json
[
  {"username": "user1", "password": "pass1", "description": "..."},
  {"username": "user2", "password": "pass2", "description": "..."}
]
```

## 8. Тест с другого сервера/компьютера

```bash
# С вашего компьютера
curl -x socks5://user1:pass1@SERVER_IP:1080 https://ifconfig.me

# Должен вернуть IP сервера
```

## Частые проблемы:

### ❌ Контейнер не запущен
**Причина:** Ошибка при создании контейнера

**Решение:**
```bash
# Смотрим ошибки
docker logs mtproxy-node-agent | tail -50

# Пробуем запустить вручную
docker run -d --name=mtproxy-socks5 \
  -p 1080:1080 \
  ginuerzh/gost -L=socks5://test:123@:1080
  
# Проверяем
curl -x socks5://test:123@localhost:1080 https://ifconfig.me
```

### ❌ Authentication failed
**Причина:** Неправильный формат аккаунтов в GOST

**Проверить:**
```bash
docker inspect mtproxy-socks5 | grep -A 5 Args
```

**Формат должен быть:**
```
-L=socks5://user1:pass1,user2:pass2@:1080
```

НЕ:
```
-L=socks5://user1:pass1@:1080,user2:pass2@:1080  ❌
```

### ❌ Connection refused (удалённо)
**Причина:** Firewall или порт не пробросан

**Решение:**
```bash
# Открыть порт в UFW
sudo ufw allow 1080/tcp

# Проверить
sudo ufw status | grep 1080

# Перезапустить firewall
sudo ufw reload
```

### ❌ Telegram не подключается
**Причина:** Неправильный домен или IP в deep link

**Проверить в боте:**
- Домен ноды: должен быть внешний IP или домен
- Порт: 1080
- Username/Password: должны совпадать с теми что в контейнере

**Deep link должен быть:**
```
tg://socks?server=YOUR_SERVER_IP&port=1080&user=username&pass=password
```

НЕ:
```
tg://socks?server=localhost&port=1080...  ❌
tg://socks?server=127.0.0.1&port=1080...  ❌
```

## Полная диагностика (запустить на сервере):

```bash
#!/bin/bash

echo "=== SOCKS5 Diagnostics ==="
echo ""

echo "1. Container status:"
docker ps | grep socks5
echo ""

echo "2. Container logs (last 20 lines):"
docker logs mtproxy-socks5 | tail -20
echo ""

echo "3. Container command:"
docker inspect mtproxy-socks5 | grep -A 10 "Args"
echo ""

echo "4. Port listening:"
netstat -tulpn | grep 1080
echo ""

echo "5. Accounts file:"
cat /root/mtproxy/node-agent/data/socks5-users.json
echo ""

echo "6. Firewall status:"
sudo ufw status | grep 1080
echo ""

echo "7. Test connection:"
curl -x socks5://$(cat /root/mtproxy/node-agent/data/socks5-users.json | jq -r '.[0].username'):$(cat /root/mtproxy/node-agent/data/socks5-users.json | jq -r '.[0].password')@localhost:1080 https://ifconfig.me
echo ""

echo "=== End ==="
```

Сохранить как `check-socks5.sh` и запустить:
```bash
chmod +x check-socks5.sh
./check-socks5.sh
```
