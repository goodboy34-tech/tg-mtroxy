# ⚙️ Настройка переменных окружения

Проект использует `.env.example` файлы как шаблоны. Перед установкой нужно создать `.env` файлы с вашими настройками.

---

## 🎛️ Control Panel

### Шаг 1: Скопировать шаблон

```bash
cd control-panel
cp .env.example .env
```

### Шаг 2: Получить Bot Token

1. Откройте [@BotFather](https://t.me/BotFather) в Telegram
2. Отправьте `/newbot`
3. Придумайте имя: `MTProxy Manager Bot`
4. Придумайте username: `myproxy_manager_bot` (должен заканчиваться на `_bot`)
5. Скопируйте полученный токен: `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`

### Шаг 3: Получить свой Telegram ID

1. Откройте [@userinfobot](https://t.me/userinfobot) в Telegram
2. Отправьте `/start`
3. Скопируйте ваш ID: `123456789`

### Шаг 4: Отредактировать .env

```bash
nano .env
```

Замените:
```bash
# Было:
BOT_TOKEN=your_telegram_bot_token_here
ADMIN_IDS=123456789,987654321

# Стало:
BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
ADMIN_IDS=123456789
```

### Шаг 5: Сохранить

- В `nano`: `Ctrl+X`, затем `Y`, затем `Enter`
- В `vim`: `:wq`

### Полный пример .env для Control Panel

```bash
# Telegram Bot Configuration
BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
ADMIN_IDS=123456789

# Database
DB_PATH=./data/mtproxy.db

# Optional: Health Check Settings
HEALTH_CHECK_INTERVAL=5m
CLEANUP_INTERVAL=24h
```

---

## 🚀 Node Agent

### Шаг 1: Скопировать шаблон

```bash
cd node-agent
cp .env.example .env
```

### Шаг 2: Сгенерировать ключи

```bash
# API Key (32 байта в hex = 64 символа)
openssl rand -hex 32
# Пример вывода: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2

# MTProxy Secret (16 байт в hex = 32 символа)
openssl rand -hex 16
# Пример вывода: 1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6
```

**⚠️ ВАЖНО:** Сохраните API Key - он понадобится для добавления ноды в Control Panel!

### Шаг 3: Определить внешний IP

```bash
curl ifconfig.me
# Пример вывода: 1.2.3.4
```

### Шаг 4: Отредактировать .env

```bash
nano .env
```

Заполните все поля:

```bash
# Node Configuration
NODE_NAME=Node1                                    # Имя вашей ноды
DOMAIN=proxy1.example.com                          # Ваш домен или IP
API_KEY=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6...       # Из шага 2

# Ports (обычно не нужно менять)
MTPROTO_PORT=443
SOCKS5_PORT=1080
API_PORT=3001

# MTProxy Settings
WORKERS=4                                          # Количество воркеров (1-16)
SECRET=1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6             # Из шага 2

# Network
NAT=                                               # Оставьте пустым, если не за NAT

# Optional: Fake-TLS Domain
FAKE_TLS_DOMAIN=www.google.com
```

### Шаг 5: Настройка для NAT (если нужно)

Если ваш сервер за NAT (внутренний IP отличается от внешнего):

```bash
# Узнать внутренний IP
hostname -I
# Пример: 10.0.0.5

# Узнать внешний IP
curl ifconfig.me
# Пример: 1.2.3.4

# Если они разные, укажите внешний IP в NAT:
NAT=1.2.3.4
```

### Полный пример .env для Node Agent

```bash
# Node Configuration
NODE_NAME=Node1
DOMAIN=proxy1.example.com
API_KEY=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2

# Ports
MTPROTO_PORT=443
SOCKS5_PORT=1080
API_PORT=3001

# MTProxy Settings
WORKERS=4
SECRET=1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6

# Network
NAT=

# Optional: Fake-TLS Domain
FAKE_TLS_DOMAIN=www.google.com
```

---

## 📋 Быстрая установка (все команды)

### Control Panel

```bash
# 1. Клонировать репозиторий
git clone https://github.com/goodboy34-tech/eeee.git
cd eeee/control-panel

# 2. Настроить .env
cp .env.example .env
nano .env
# Укажите BOT_TOKEN и ADMIN_IDS

# 3. Установить
sudo bash scripts/install.sh
```

### Node Agent

```bash
# 1. Клонировать репозиторий
git clone https://github.com/goodboy34-tech/eeee.git
cd eeee/node-agent

# 2. Сгенерировать ключи
echo "API_KEY: $(openssl rand -hex 32)"
echo "SECRET: $(openssl rand -hex 16)"
echo "External IP: $(curl -s ifconfig.me)"

# 3. Настроить .env
cp .env.example .env
nano .env
# Заполните все поля из шага 2

# 4. Установить
sudo bash scripts/install.sh
```

---

## 🔧 Проверка конфигурации

### Control Panel

```bash
# Проверить, что .env существует
ls -la .env

# Посмотреть содержимое (без токенов)
cat .env | grep -v TOKEN | grep -v KEY
```

### Node Agent

```bash
# Проверить, что .env существует
ls -la .env

# Проверить API_KEY (первые 10 символов)
cat .env | grep API_KEY | cut -c1-20

# Проверить все настройки
cat .env
```

---

## ❓ Частые вопросы

### Q: Что делать, если я забыл скопировать API Key?

```bash
cd node-agent
cat .env | grep API_KEY
```

### Q: Можно ли изменить .env после установки?

Да, но нужно перезапустить:

```bash
nano .env
# Внесите изменения

docker-compose down
docker-compose up -d --build
```

### Q: Как добавить несколько админов в Control Panel?

```bash
# В .env укажите ID через запятую
ADMIN_IDS=123456789,987654321,555666777
```

### Q: Нужно ли менять порты?

Обычно нет, но если порты заняты:

```bash
# В .env измените порты
MTPROTO_PORT=8443
SOCKS5_PORT=8080
API_PORT=8001

# Также обновите docker-compose.yml
```

### Q: Где хранятся .env файлы?

```
eeee/
├── control-panel/
│   └── .env              # ✅ Создайте из .env.example
│
└── node-agent/
    └── .env              # ✅ Создайте из .env.example
```

### Q: Как защитить .env файлы?

```bash
# Ограничить доступ только владельцу
chmod 600 .env

# Проверить права
ls -la .env
# Должно быть: -rw------- (600)
```

---

## 🔐 Безопасность

### ✅ Рекомендации:

1. **Никогда не коммитьте** `.env` файлы в git (они в `.gitignore`)
2. **Используйте сильные ключи** - минимум 32 байта для API_KEY
3. **Храните резервные копии** `.env` файлов в безопасном месте
4. **Не делитесь** токенами и ключами
5. **Регулярно меняйте** API ключи

### Резервное копирование:

```bash
# Control Panel
cp control-panel/.env control-panel/.env.backup

# Node Agent
cp node-agent/.env node-agent/.env.backup

# Сохранить в другое место
scp control-panel/.env user@backup-server:/backups/
```

---

**Готово! Теперь можете устанавливать проект.** 🚀
