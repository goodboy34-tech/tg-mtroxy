# 🔐 Безопасность MTProxy Management System

## Архитектура взаимодействия

```
┌─────────────────┐         HTTPS          ┌─────────────────┐
│  Telegram Bot   │ ◄──────────────────────►│   Telegram API  │
│  (Control Panel)│                         └─────────────────┘
└────────┬────────┘
         │
         │ HTTP(S) + Bearer Token
         │ (внутренняя сеть)
         ▼
┌─────────────────┐
│   Node Agent    │
│   API Server    │
│   (порт 3000)   │
└─────────────────┘
```

## 1️⃣ Аутентификация между Control Panel и Node

### Bearer Token Authentication

**Как это работает:**

1. **Генерация токена** (при добавлении ноды):
   ```typescript
   // control-panel/src/node-client.ts
   static generateApiToken(): string {
     return crypto.randomBytes(32).toString('hex'); // 64 символа HEX
   }
   ```

2. **Отправка запроса от бота**:
   ```typescript
   headers: {
     'Authorization': `Bearer ${apiToken}`,
     'Content-Type': 'application/json'
   }
   ```

3. **Проверка на ноде**:
   ```typescript
   // node-agent/src/api.ts
   function authenticate(req, res, next) {
     const auth = req.headers.authorization;
     if (!auth || !auth.startsWith('Bearer ')) {
       return res.status(401).json({ error: 'Unauthorized' });
     }
     const token = auth.substring(7);
     if (token !== API_TOKEN) {
       return res.status(403).json({ error: 'Forbidden' });
     }
     next();
   }
   ```

### Уровни безопасности

| Сценарий | Безопасность | Рекомендация |
|----------|--------------|--------------|
| **Bot и Node на одном сервере** | ✅ Отлично | Используйте `http://localhost:3000` |
| **Bot и Node в одной приватной сети** | ✅ Хорошо | Используйте приватные IP (10.x.x.x, 172.16-31.x.x, 192.168.x.x) |
| **Bot и Node через интернет** | ⚠️ Требует защиты | **Используйте HTTPS** (см. ниже) |

## 2️⃣ Настройка HTTPS для Node Agent (рекомендуется)

### Вариант A: Nginx Reverse Proxy (рекомендуется)

Самый простой способ - поставить Nginx перед Node Agent:

```bash
# На сервере с нодой
apt install nginx certbot python3-certbot-nginx

# Получить Let's Encrypt сертификат
certbot --nginx -d node.yourdomain.com

# Конфигурация Nginx
cat > /etc/nginx/sites-available/node-agent <<'EOF'
server {
    listen 443 ssl http2;
    server_name node.yourdomain.com;
    
    ssl_certificate /etc/letsencrypt/live/node.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/node.yourdomain.com/privkey.pem;
    
    # Только для Control Panel
    allow 1.2.3.4;  # IP адрес сервера с Control Panel
    deny all;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
EOF

ln -s /etc/nginx/sites-available/node-agent /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### Вариант B: Cloudflare Tunnel (Zero Trust)

```bash
# Установка cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared

# Аутентификация
cloudflared tunnel login

# Создание туннеля
cloudflared tunnel create mtproxy-node-1
cloudflared tunnel route dns mtproxy-node-1 node.yourdomain.com

# Конфигурация
cat > ~/.cloudflared/config.yml <<EOF
tunnel: <tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: node.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
EOF

# Запуск как сервис
cloudflared service install
systemctl start cloudflared
```

### Вариант C: VPN между серверами

Используйте WireGuard или Tailscale для создания приватной сети:

```bash
# Tailscale (самый простой)
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up

# Теперь используйте Tailscale IP в настройках ноды
# Пример: http://100.64.1.2:3000
```

## 3️⃣ Дополнительные меры безопасности

### Firewall (обязательно)

```bash
# На сервере с нодой - закрыть порт 3000 от внешнего доступа
ufw allow from <CONTROL_PANEL_IP> to any port 3000
ufw deny 3000

# Открыть только MTProxy и SOCKS5 порты
ufw allow 443/tcp   # MTProxy
ufw allow 1080/tcp  # SOCKS5
ufw enable
```

### IP Whitelist в Node Agent

Можно добавить проверку IP в код:

```typescript
// node-agent/src/api.ts
const ALLOWED_IPS = process.env.ALLOWED_IPS?.split(',') || [];

app.use((req, res, next) => {
  const clientIp = req.ip || req.connection.remoteAddress;
  
  if (ALLOWED_IPS.length > 0 && !ALLOWED_IPS.includes(clientIp)) {
    return res.status(403).json({ error: 'IP not allowed' });
  }
  
  next();
});
```

### Ротация токенов

Регулярно меняйте API токены:

```sql
-- В базе Control Panel
UPDATE nodes SET api_token = '<new_token>' WHERE id = 1;

-- На ноде обновите .env
echo "API_TOKEN=<new_token>" >> /opt/mtproxy-node/node-agent/.env
mtproxy-node restart
```

## 4️⃣ Telegram Bot безопасность

### Проверка админов

```typescript
// control-panel/src/bot.ts
const ADMIN_IDS = process.env.ADMIN_IDS.split(',').map(id => parseInt(id));

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId || !ADMIN_IDS.includes(userId)) {
    return; // Игнорируем запросы от неадминов
  }
  await next();
});
```

### Защита токена бота

```bash
# .env должен быть защищён
chmod 600 /opt/mtproxy-control/.env

# Не коммитьте .env в git
echo ".env" >> .gitignore
```

## 5️⃣ Мониторинг трафика (vnstat)

### Оптимизация парсинга

Используем компактный формат вместо полного JSON:

```typescript
// Вместо: vnstat --json (большой JSON ~50KB)
// Используем: vnstat --oneline b (одна строка ~100 байт)

const output = execSync('vnstat --oneline b').toString();
// Результат: eth0;2024-02-11;123456;654321;...;12345678901;98765432109
//                                              ^^rx_total  ^^tx_total
```

**Преимущества:**
- ✅ Минимальная нагрузка на CPU (нет парсинга JSON)
- ✅ Быстрый парсинг (split по `;`)
- ✅ Меньше памяти
- ✅ Быстрее выполнение запроса

## 📊 Сравнение форматов vnstat

| Формат | Размер вывода | Время парсинга | Использование |
|--------|---------------|----------------|---------------|
| `vnstat --json` | ~50 KB | ~5ms | Полная статистика с историей |
| `vnstat --json s` | ~5 KB | ~2ms | Только summary |
| `vnstat --oneline b` | ~100 байт | <1ms | **Только total (рекомендуется)** |

## ✅ Checklist безопасности

- [ ] API токены генерируются криптографически стойко (crypto.randomBytes)
- [ ] Токены хранятся в переменных окружения, не в коде
- [ ] Node Agent API доступен только из приватной сети или через HTTPS
- [ ] Настроен firewall на сервере с нодой
- [ ] Только указанные Telegram ID имеют доступ к боту
- [ ] Файлы .env имеют права 600 (только root может читать)
- [ ] Регулярно обновляются компоненты системы
- [ ] Логи проверяются на подозрительную активность

## 🚨 Что делать при компрометации

1. **Если скомпрометирован API токен ноды:**
   ```bash
   # Сгенерируйте новый токен в боте: /node <id> → Изменить токен
   # Или вручную:
   NEW_TOKEN=$(openssl rand -hex 32)
   # Обновите в базе Control Panel и в .env ноды
   ```

2. **Если скомпрометирован токен Telegram бота:**
   ```bash
   # Отзовите старый токен через @BotFather
   # Создайте нового бота или получите новый токен
   # Обновите BOT_TOKEN в .env Control Panel
   ```

3. **Если подозрительная активность:**
   ```bash
   # Проверьте логи
   mtproxy-control logs | grep -i "unauthorized\|forbidden\|error"
   
   # Проверьте подключения
   netstat -tupn | grep :3000
   ```

## 📚 Дополнительные ресурсы

- [OWASP API Security Top 10](https://owasp.org/www-project-api-security/)
- [Bearer Token Best Practices](https://datatracker.ietf.org/doc/html/rfc6750)
- [Docker Security](https://docs.docker.com/engine/security/)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
