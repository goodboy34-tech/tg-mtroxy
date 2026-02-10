# 🚀 Быстрая установка

## ⚡ Control Panel (за 3 минуты)

```bash
# 1. Клонировать
git clone https://github.com/goodboy34-tech/eeee.git
cd eeee/control-panel

# 2. Настроить .env
cp .env.example .env
nano .env

# Вставьте:
# BOT_TOKEN=получите_у_@BotFather
# ADMIN_IDS=получите_у_@userinfobot

# 3. Установить
sudo bash scripts/install.sh
```

**Готово!** Откройте бота в Telegram и отправьте `/start`

---

## ⚡ Node Agent (за 5 минут)

```bash
# 1. Клонировать
git clone https://github.com/goodboy34-tech/eeee.git
cd eeee/node-agent

# 2. Сгенерировать ключи
openssl rand -hex 32  # API Key → сохраните!
openssl rand -hex 16  # MTProxy Secret

# 3. Настроить .env
cp .env.example .env
nano .env

# Заполните:
# NODE_NAME=Node1
# DOMAIN=ваш_домен_или_IP
# API_KEY=ключ_из_шага_2
# SECRET=секрет_из_шага_2
# WORKERS=4

# 4. Установить
sudo bash scripts/install.sh
```

**Готово!** Добавьте ноду в Control Panel через `/add_node`

---

## 📝 Что нужно получить ПЕРЕД установкой

### Control Panel:
1. **Bot Token** от [@BotFather](https://t.me/BotFather):
   - `/newbot` → придумайте имя → скопируйте токен

2. **Ваш Telegram ID** от [@userinfobot](https://t.me/userinfobot):
   - `/start` → скопируйте ID

### Node Agent:
1. **API Key** (32 байта):
   ```bash
   openssl rand -hex 32
   ```

2. **MTProxy Secret** (16 байт):
   ```bash
   openssl rand -hex 16
   ```

3. **Внешний IP**:
   ```bash
   curl ifconfig.me
   ```

---

## 🔗 Подключение ноды

После установки обоих компонентов, в Telegram боте:

```
/add_node Node1 proxy.example.com https://IP:3001 API_KEY
```

Замените:
- `Node1` - имя ноды (из .env)
- `proxy.example.com` - домен (из .env)
- `IP` - внешний IP сервера ноды
- `API_KEY` - ключ из .env ноды

---

## ✅ Проверка установки

### Control Panel:
```bash
cd control-panel
docker-compose ps  # Должен быть Up
docker-compose logs -f  # Должно быть: Bot запущен!
```

### Node Agent:
```bash
cd node-agent
docker-compose ps  # Все 3 контейнера Up
curl -k https://localhost:3001/health  # {"status":"ok"}
```

---

## 🎯 Первые шаги

### 1. Создать MTProto прокси с Fake-TLS:
```
/add_secret 1 dd
```

### 2. Создать SOCKS5 с авторизацией:
```
/add_socks5 1
```

### 3. Получить ссылки для Telegram:
```
/links 1
```

### 4. Создать подписку для пользователей:
```
/create_subscription
```

---

## 📚 Полная документация

- **[ENV-SETUP.md](./ENV-SETUP.md)** - Подробная настройка .env файлов
- **[INSTALLATION.md](./INSTALLATION.md)** - Полная инструкция установки
- **[README.md](./README.md)** - Обзор всей системы

---

## ❓ Проблемы?

### Бот не отвечает:
```bash
cd control-panel
cat .env | grep BOT_TOKEN  # Проверьте токен
docker-compose restart
```

### Нода недоступна:
```bash
cd node-agent
cat .env | grep API_KEY  # Проверьте ключ
curl -k https://localhost:3001/health
docker-compose restart
```

### Порты заняты:
```bash
netstat -tupln | grep -E '443|1080|3001'
# Измените порты в .env и docker-compose.yml
```

---

**🎉 Удачи с установкой!**

**⭐ Поставьте звезду на GitHub:** https://github.com/goodboy34-tech/eeee
