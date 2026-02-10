# 🔧 Решение проблем при установке

## TypeScript ошибка TS4023

**Ошибка:**
```
error TS4023: Exported variable 'queries' has or is using name 'BetterSqlite3.Statement' 
from external module but cannot be named.
```

**Решение:** ✅ Уже исправлено в коммите `b857068`

Обновите код:
```bash
git pull origin master
```

---

## Установка на Linux (рекомендуется)

Проект предназначен для работы на **Linux серверах** (Ubuntu/Debian).

### Control Panel

```bash
# 1. Клонировать на сервер
git clone https://github.com/goodboy34-tech/eeee.git
cd eeee/control-panel

# 2. Настроить .env
cp .env.example .env
nano .env
# Укажите BOT_TOKEN и ADMIN_IDS

# 3. Установить (Docker всё сделает автоматически)
sudo bash scripts/install.sh
```

### Node Agent

```bash
# 1. Клонировать на прокси-сервер
git clone https://github.com/goodboy34-tech/eeee.git
cd eeee/node-agent

# 2. Настроить .env
cp .env.example .env
openssl rand -hex 32  # Сгенерировать API Key
openssl rand -hex 16  # Сгенерировать Secret
nano .env             # Заполнить все поля

# 3. Установить (Docker всё сделает автоматически)
sudo bash scripts/install.sh
```

**Docker установит все зависимости автоматически**, включая:
- Node.js
- TypeScript
- better-sqlite3 (скомпилируется внутри контейнера)
- Все остальные пакеты

---

## Установка на Windows (для разработки)

Windows не поддерживается для production, но можно разрабатывать код.

### Проблема: better-sqlite3

`better-sqlite3` требует компиляции нативных модулей, для этого нужен Visual Studio.

### Решение 1: Установить Visual Studio Build Tools

```powershell
# Скачайте и установите:
# https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022

# Выберите при установке:
# ✅ Desktop development with C++
```

Затем:
```powershell
cd control-panel
npm install
npm run build
```

### Решение 2: Использовать WSL2 (рекомендуется)

```powershell
# Установите WSL2
wsl --install

# Перезагрузите компьютер

# Откройте Ubuntu в WSL
wsl

# Теперь работайте как на Linux:
git clone https://github.com/goodboy34-tech/eeee.git
cd eeee/control-panel
cp .env.example .env
nano .env
sudo bash scripts/install.sh
```

### Решение 3: Только разработка кода (без компиляции)

Если вы редактируете только код и не запускаете локально:

```powershell
cd control-panel

# Установите только TypeScript для проверки синтаксиса
npm install -D typescript @types/node

# Проверка синтаксиса (без компиляции)
npx tsc --noEmit
```

---

## Docker на Windows

### Проблема: Docker Desktop

Docker Desktop для Windows может работать медленно.

### Решение: Используйте Docker в WSL2

```powershell
# В PowerShell:
wsl

# В WSL Ubuntu:
# Установите Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Запустите Docker
sudo service docker start

# Теперь можете использовать docker-compose
cd /mnt/c/Users/ERA/Documents/gproxy/tg-mtproxy/control-panel
sudo docker-compose up -d
```

---

## Частые ошибки

### `Cannot find module 'better-sqlite3'`

**Причина:** Зависимости не установлены

**Решение:**
```bash
npm install
```

### `gyp ERR! find VS`

**Причина:** На Windows нет Visual Studio Build Tools

**Решение:** См. "Решение 1: Установить Visual Studio Build Tools" выше

### `ECONNRESET` при `npm install`

**Причина:** Проблемы с сетью или прокси

**Решение:**
```bash
# Очистите кэш npm
npm cache clean --force

# Попробуйте снова
npm install

# Или используйте другое зеркало
npm install --registry=https://registry.npmmirror.com
```

### `Permission denied` при запуске скриптов

**Решение:**
```bash
# Дайте права на выполнение
chmod +x scripts/install.sh
chmod +x scripts/uninstall.sh

# Запустите с sudo
sudo bash scripts/install.sh
```

---

## Рекомендуемая среда разработки

### Для production:
- **OS:** Ubuntu 20.04/22.04 или Debian 10/11
- **Установка:** Через Docker (скрипты install.sh)

### Для разработки на Windows:
- **Вариант 1:** WSL2 + Ubuntu (рекомендуется)
- **Вариант 2:** Docker Desktop + WSL2 backend
- **Вариант 3:** VS Code + Remote-WSL расширение

### Для разработки на Mac:
```bash
# Установите Docker Desktop для Mac
# Затем:
git clone https://github.com/goodboy34-tech/eeee.git
cd eeee/control-panel
cp .env.example .env
nano .env
docker-compose up -d --build
```

---

## Проверка установки

### Без запуска (только синтаксис TypeScript):

```bash
# Установите только TypeScript
npm install -D typescript @types/node @types/better-sqlite3

# Проверка синтаксиса
npx tsc --noEmit
```

### С запуском (нужны все зависимости):

```bash
# Полная установка
npm install

# Сборка
npm run build

# Запуск
npm start
```

### Через Docker (рекомендуется):

```bash
# Сборка и запуск
docker-compose up -d --build

# Проверка
docker-compose ps
docker-compose logs -f
```

---

## Полезные ссылки

- **Visual Studio Build Tools:** https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
- **WSL2 Installation:** https://docs.microsoft.com/en-us/windows/wsl/install
- **Docker Desktop:** https://www.docker.com/products/docker-desktop
- **node-gyp на Windows:** https://github.com/nodejs/node-gyp#on-windows
- **better-sqlite3:** https://github.com/WiseLibs/better-sqlite3

---

## Поддержка

Если проблема не решена:

1. Проверьте версию Node.js: `node --version` (нужна 18+)
2. Проверьте версию npm: `npm --version` (нужна 9+)
3. Очистите кэш: `npm cache clean --force`
4. Удалите node_modules: `rm -rf node_modules package-lock.json`
5. Установите заново: `npm install`
6. Создайте issue на GitHub с логами ошибки

---

**Рекомендация:** Для production всегда используйте **Linux + Docker**. Это проще, стабильнее и безопаснее. 🐧🐳
