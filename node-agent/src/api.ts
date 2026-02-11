import express, { Request, Response, NextFunction } from 'express';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

const app = express();
app.use(express.json());

const API_TOKEN = process.env.API_TOKEN || '';
const DOMAIN = process.env.DOMAIN || 'localhost';
const INTERNAL_IP = process.env.INTERNAL_IP || '';
const MTPROTO_PORT = parseInt(process.env.MTPROTO_PORT || '443');
const SOCKS5_PORT = parseInt(process.env.SOCKS5_PORT || '1080');
const WORKERS = parseInt(process.env.WORKERS || '2');
const AD_TAG = process.env.AD_TAG || ''; // Опциональный рекламный тег

// Путь к файлам конфигурации
const DATA_DIR = path.join(__dirname, '..', 'data');
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');
const SOCKS5_USERS_FILE = path.join(DATA_DIR, 'socks5-users.json');

// Убедимся что директория существует
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ═══════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════

// Аутентификация
function authenticate(req: Request, res: Response, next: NextFunction) {
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

app.use(authenticate);

// ═══════════════════════════════════════════════
// HEALTH & STATUS
// ═══════════════════════════════════════════════

app.get('/ping', (req, res) => {
  res.json({ pong: true, timestamp: Date.now() });
});

app.get('/health', async (req, res) => {
  try {
    const mtprotoRunning = isContainerRunning('mtproxy');
    const socks5Running = isContainerRunning('mtproxy-socks5');
    
    const cpuUsage = await getCpuUsage();
    const ramUsage = await getRamUsage();
    const diskUsage = await getDiskUsage();
    const uptime = getUptime();

    // Node agent работает - всегда healthy
    // MTProto и SOCKS5 опциональны (могут не быть созданы)
    const status = 'healthy';

    res.json({
      status,
      uptime,
      mtproto: {
        running: mtprotoRunning,
        workers: WORKERS,
      },
      socks5: {
        running: socks5Running,
      },
      system: {
        cpuUsage,
        ramUsage,
        diskUsage,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/stats', async (req, res) => {
  try {
    const mtprotoStats = await getMtProtoStats();
    const socks5Stats = await getSocks5Stats();
    const networkStats = await getNetworkStats();

    res.json({
      mtproto: mtprotoStats,
      socks5: socks5Stats,
      network: networkStats,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════
// MTPROTO MANAGEMENT
// ═══════════════════════════════════════════════

app.get('/mtproto/secrets', (req, res) => {
  const secrets = loadSecrets();
  res.json(secrets);
});

app.post('/mtproto/secrets', async (req, res) => {
  try {
    const { secret, isFakeTls, description } = req.body;

    if (!secret || secret.length !== 32) {
      return res.status(400).json({ error: 'Invalid secret (must be 32 hex chars)' });
    }

    const secrets = loadSecrets();
    secrets.push({ secret, isFakeTls: !!isFakeTls, description: description || '' });
    saveSecrets(secrets);

    // Перезапускаем MTProto с новыми секретами
    await restartMtProto();

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/mtproto/secrets/:secret', async (req, res) => {
  try {
    const { secret } = req.params;
    
    let secrets = loadSecrets();
    const initialLength = secrets.length;
    secrets = secrets.filter(s => s.secret !== secret);

    if (secrets.length === initialLength) {
      return res.status(404).json({ error: 'Secret not found' });
    }

    saveSecrets(secrets);
    await restartMtProto();

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/mtproto/restart', async (req, res) => {
  try {
    await restartMtProto();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/mtproto/workers', async (req, res) => {
  try {
    const { workers } = req.body;
    
    if (!workers || workers < 1 || workers > 32) {
      return res.status(400).json({ error: 'Invalid workers count (1-32)' });
    }

    // Обновляем переменную окружения и перезапускаем
    process.env.WORKERS = workers.toString();
    await restartMtProto();

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/mtproto/config', async (req, res) => {
  try {
    const { workers, tag, natInfo } = req.body;
    
    // Обновляем конфиг
    if (workers) {
      if (workers < 1 || workers > 32) {
        return res.status(400).json({ error: 'Invalid workers count (1-32)' });
      }
      process.env.WORKERS = workers.toString();
    }
    
    if (tag !== undefined) {
      process.env.AD_TAG = tag || '';
    }
    
    if (natInfo) {
      // Формат: internal_ip:external_domain
      const [ip, domain] = natInfo.split(':');
      if (ip) process.env.INTERNAL_IP = ip;
      if (domain) process.env.DOMAIN = domain;
    }
    
    // Перезапускаем с новым конфигом
    await restartMtProto();

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════
// SOCKS5 MANAGEMENT
// ═══════════════════════════════════════════════

app.get('/socks5/accounts', (req, res) => {
  const accounts = loadSocks5Accounts();
  res.json(accounts);
});

app.post('/socks5/accounts', async (req, res) => {
  try {
    const { username, password, description } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const accounts = loadSocks5Accounts();
    
    // Проверяем дубликаты
    if (accounts.find(a => a.username === username)) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    accounts.push({ username, password, description: description || '' });
    saveSocks5Accounts(accounts);

    // Обновляем конфигурацию SOCKS5 (пересоздаёт контейнер)
    await updateSocks5Config(accounts);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/socks5/accounts/:username', async (req, res) => {
  try {
    const { username } = req.params;
    
    let accounts = loadSocks5Accounts();
    const initialLength = accounts.length;
    accounts = accounts.filter(a => a.username !== username);

    if (accounts.length === initialLength) {
      return res.status(404).json({ error: 'Account not found' });
    }

    saveSocks5Accounts(accounts);
    
    // Обновляем конфигурацию SOCKS5 (пересоздаёт контейнер)
    await updateSocks5Config(accounts);

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/socks5/restart', async (req, res) => {
  try {
    await restartSocks5();
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════
// SYSTEM MANAGEMENT
// ═══════════════════════════════════════════════

app.post('/system/execute', async (req, res) => {
  try {
    const { script } = req.body;

    if (!script) {
      return res.status(400).json({ error: 'Script required' });
    }

    // Безопасность: разрешаем только определенные команды
    const allowedCommands = ['docker', 'curl', 'wget', 'systemctl', 'df', 'free', 'top'];
    const firstWord = script.trim().split(' ')[0];
    
    if (!allowedCommands.includes(firstWord)) {
      return res.status(403).json({ error: 'Command not allowed' });
    }

    const { stdout, stderr } = await execAsync(script);
    
    res.json({
      success: true,
      output: stdout || stderr,
      exitCode: 0,
    });
  } catch (error: any) {
    res.json({
      success: false,
      output: error.message,
      exitCode: error.code || 1,
    });
  }
});

app.get('/system/logs', async (req, res) => {
  try {
    const lines = parseInt(req.query.lines as string) || 100;

    const mtprotoLogs = execSync(`docker logs --tail ${lines} mtproxy 2>&1`).toString();
    const socks5Logs = execSync(`docker logs --tail ${lines} mtproxy-socks5 2>&1`).toString();
    const agentLogs = execSync(`docker logs --tail ${lines} mtproxy-node-agent 2>&1`).toString();

    res.json({
      mtproto: mtprotoLogs,
      socks5: socks5Logs,
      agent: agentLogs,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/system/update-proxy-files', async (req, res) => {
  try {
    // Обновляем proxy-secret и proxy-multi.conf
    await execAsync('curl -s https://core.telegram.org/getProxySecret -o /tmp/proxy-secret');
    await execAsync('curl -s https://core.telegram.org/getProxyConfig -o /tmp/proxy-multi.conf');
    
    // Копируем в контейнер MTProxy
    await execAsync('docker cp /tmp/proxy-secret mtproxy:/data/proxy-secret');
    await execAsync('docker cp /tmp/proxy-multi.conf mtproxy:/data/proxy-multi.conf');
    
    await restartMtProto();

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════

function loadSecrets(): Array<{ secret: string; isFakeTls: boolean; description: string }> {
  if (!fs.existsSync(SECRETS_FILE)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
}

function saveSecrets(secrets: Array<{ secret: string; isFakeTls: boolean; description: string }>) {
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2));
}

function loadSocks5Accounts(): Array<{ username: string; password: string; description: string }> {
  if (!fs.existsSync(SOCKS5_USERS_FILE)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(SOCKS5_USERS_FILE, 'utf8'));
}

function saveSocks5Accounts(accounts: Array<{ username: string; password: string; description: string }>) {
  fs.writeFileSync(SOCKS5_USERS_FILE, JSON.stringify(accounts, null, 2));
}

async function restartMtProto(): Promise<void> {
  const secrets = loadSecrets();
  const secretsStr = secrets.map(s => s.secret).join(',');

  if (secrets.length === 0) {
    console.log('[MTProto] No secrets, stopping container');
    execSync('docker stop mtproxy || true');
    return;
  }

  console.log(`[MTProto] Restarting with ${secrets.length} secrets, ${WORKERS} workers`);

  // Останавливаем старый контейнер
  execSync('docker stop mtproxy || true');
  execSync('docker rm mtproxy || true');

  // Формируем команду запуска
  let cmd = 'docker run -d --name=mtproxy --restart=unless-stopped ' +
            '-p 443:443 -p 2398:2398 ' +
            `-e SECRET=${secretsStr} ` +
            `-e WORKERS=${WORKERS} `;

  // Если есть NAT info
  if (INTERNAL_IP && DOMAIN) {
    cmd += `--env NAT_INFO=${INTERNAL_IP}:${DOMAIN} `;
  }

  // Если есть AD_TAG (рекламный тег)
  if (AD_TAG) {
    cmd += `--env TAG=${AD_TAG} `;
    console.log(`[MTProto] Using AD_TAG: ${AD_TAG}`);
  }

  cmd += 'telegrammessenger/proxy:latest';

  execSync(cmd);
  console.log('[MTProto] Container restarted');
}

async function restartSocks5(): Promise<void> {
  console.log('[SOCKS5] Restarting container');
  execSync('docker restart mtproxy-socks5');
  console.log('[SOCKS5] Container restarted');
}

async function updateSocks5Config(accounts: Array<{ username: string; password: string }>): Promise<void> {
  console.log(`[SOCKS5] Updating GOST config with ${accounts.length} accounts`);

  // Останавливаем старый контейнер
  try {
    execSync('docker stop mtproxy-socks5 || true');
    execSync('docker rm mtproxy-socks5 || true');
  } catch (error) {
    console.log('[SOCKS5] No existing container to remove');
  }

  if (accounts.length === 0) {
    console.log('[SOCKS5] No accounts, SOCKS5 disabled');
    return;
  }

  // GOST v3 с JSON конфигом
  const gostConfig = {
    services: [{
      name: "socks5",
      addr: `:${SOCKS5_PORT}`,
      handler: {
        type: "socks5",
        auther: "auther0"
      },
      listener: {
        type: "tcp"
      }
    }],
    authers: [{
      name: "auther0",
      auths: accounts.map(acc => ({
        username: acc.username,
        password: acc.password
      }))
    }]
  };
  
  const configFile = path.join(DATA_DIR, 'gost.json');
  fs.writeFileSync(configFile, JSON.stringify(gostConfig, null, 2));
  console.log(`[SOCKS5] GOST v3 config created with ${accounts.length} accounts`);

  // ВАЖНО: node-agent работает в контейнере с volume mount
  // DATA_DIR внутри контейнера = /app/data
  // На хосте это монтируется из ./node-data (или где указано в docker-compose)
  // 
  // Решение: используем --volumes-from чтобы новый контейнер получил доступ к тому же volume
  const cmd = `docker run -d --name=mtproxy-socks5 --restart=unless-stopped ` +
              `-p ${SOCKS5_PORT}:${SOCKS5_PORT} ` +
              `--volumes-from ${process.env.HOSTNAME || 'mtproxy-node-agent'} ` +
              `gogost/gost -C /app/data/gost.json`;

  try {
    execSync(cmd);
    console.log('[SOCKS5] Container started successfully with GOST v3');
  } catch (error) {
    console.error('[SOCKS5] Failed to start container:', error);
    throw error;
  }
}

function isContainerRunning(containerName: string): boolean {
  try {
    const result = execSync(`docker inspect -f '{{.State.Running}}' ${containerName} 2>/dev/null`).toString().trim();
    return result === 'true';
  } catch {
    return false;
  }
}

async function getCpuUsage(): Promise<number> {
  try {
    // Способ 1: top (GNU/Linux)
    try {
      const result = await execAsync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | sed 's/%us,//'");
      const cpu = parseFloat(result.stdout.trim());
      if (!isNaN(cpu)) return cpu;
    } catch (e) {}
    
    // Способ 2: mpstat (если установлен)
    try {
      const result = await execAsync("mpstat 1 1 | awk '/Average:/ {print 100-$NF}'");
      const cpu = parseFloat(result.stdout.trim());
      if (!isNaN(cpu)) return cpu;
    } catch (e) {}
    
    // Способ 3: /proc/stat (универсальный Linux)
    try {
      const stat1 = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].split(/\s+/).slice(1).map(Number);
      await new Promise(resolve => setTimeout(resolve, 100));
      const stat2 = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].split(/\s+/).slice(1).map(Number);
      
      const idle1 = stat1[3];
      const idle2 = stat2[3];
      const total1 = stat1.reduce((a, b) => a + b, 0);
      const total2 = stat2.reduce((a, b) => a + b, 0);
      
      const totalDiff = total2 - total1;
      const idleDiff = idle2 - idle1;
      
      return ((totalDiff - idleDiff) / totalDiff) * 100;
    } catch (e) {}
    
    return 0;
  } catch {
    return 0;
  }
}

async function getRamUsage(): Promise<number> {
  try {
    const result = await execAsync("free | awk '/Mem:/ {printf \"%.1f\", $3/$2 * 100}'");
    return parseFloat(result.stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

async function getDiskUsage(): Promise<number> {
  try {
    const result = await execAsync("df -h / | awk 'NR==2 {print $5}' | sed 's/%//'");
    return parseFloat(result.stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

function getUptime(): number {
  try {
    const result = execSync("awk '{print $1}' /proc/uptime").toString().trim();
    return parseFloat(result);
  } catch {
    return 0;
  }
}

async function getMtProtoStats() {
  try {
    const result = await execAsync('docker exec mtproxy curl -s http://localhost:2398/stats 2>/dev/null');
    const lines = result.stdout.split('\n');
    
    const stats: any = {
      connections: 0,
      maxConnections: 0,
      readyTargets: 0,
      activeTargets: 0,
    };

    for (const line of lines) {
      const [key, value] = line.split('\t');
      if (key === 'total_special_connections') stats.connections = parseInt(value) || 0;
      if (key === 'total_max_special_connections') stats.maxConnections = parseInt(value) || 0;
      if (key === 'ready_targets') stats.readyTargets = parseInt(value) || 0;
      if (key === 'active_targets') stats.activeTargets = parseInt(value) || 0;
    }

    return stats;
  } catch {
    return { connections: 0, maxConnections: 0, readyTargets: 0, activeTargets: 0 };
  }
}

async function getSocks5Stats() {
  try {
    // GOST v3 не предоставляет статистику через API
    // Но мы можем подсчитать активные соединения через netstat/ss
    
    // Пробуем ss (более современный)
    try {
      const result = execSync(
        `ss -tn state established 2>/dev/null | grep :${SOCKS5_PORT} | wc -l`
      ).toString().trim();
      
      const connections = parseInt(result) || 0;
      return { connections };
    } catch (e) {
      // Fallback: netstat
      try {
        const result = execSync(
          `netstat -tn 2>/dev/null | grep :${SOCKS5_PORT} | grep ESTABLISHED | wc -l`
        ).toString().trim();
        
        const connections = parseInt(result) || 0;
        return { connections };
      } catch (e2) {
        // Последний fallback: Docker stats
        try {
          const containerStats = execSync(
            "docker stats --no-stream --format '{{.NetIO}}' mtproxy-socks5 2>/dev/null"
          ).toString().trim();
          
          // Если контейнер активен и есть трафик - считаем что есть соединения
          const hasTraffic = containerStats && containerStats !== '0B / 0B';
          return { connections: hasTraffic ? 1 : 0 };
        } catch (e3) {
          return { connections: 0 };
        }
      }
    }
  } catch {
    return { connections: 0 };
  }
}

async function getNetworkStats() {
  try {
    // Метод 1: Читаем /proc/net/dev для всех интерфейсов
    try {
      const netDev = fs.readFileSync('/proc/net/dev', 'utf8');
      const lines = netDev.split('\n');
      
      let totalRx = 0;
      let totalTx = 0;
      
      // Пропускаем первые 2 строки (заголовки)
      for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        // Формат: "eth0: 123456 ..."
        const parts = line.split(/\s+/);
        if (parts.length < 10) continue;
        
        const iface = parts[0].replace(':', '');
        // Пропускаем loopback и docker интерфейсы
        if (iface === 'lo' || iface.startsWith('docker')) continue;
        
        const rxBytes = parseInt(parts[1]) || 0;
        const txBytes = parseInt(parts[9]) || 0;
        
        totalRx += rxBytes;
        totalTx += txBytes;
      }
      
      if (totalRx > 0 || totalTx > 0) {
        return {
          inMb: totalRx / 1024 / 1024,
          outMb: totalTx / 1024 / 1024,
        };
      }
    } catch (e) {
      // Продолжаем к следующему методу
    }
    
    // Метод 2: Пробуем конкретные интерфейсы через /sys/class/net
    const interfaces = ['eth0', 'ens3', 'enp0s3', 'ens18', 'venet0', 'ens5'];
    
    for (const iface of interfaces) {
      try {
        const rxPath = `/sys/class/net/${iface}/statistics/rx_bytes`;
        const txPath = `/sys/class/net/${iface}/statistics/tx_bytes`;
        
        if (fs.existsSync(rxPath) && fs.existsSync(txPath)) {
          const rxBytes = parseInt(fs.readFileSync(rxPath, 'utf8').trim());
          const txBytes = parseInt(fs.readFileSync(txPath, 'utf8').trim());
          
          return {
            inMb: rxBytes / 1024 / 1024,
            outMb: txBytes / 1024 / 1024,
          };
        }
      } catch (e) {
        continue;
      }
    }
    
    // Метод 3 (Fallback): Docker stats для MTProxy контейнера
    try {
      // Используем docker inspect для получения накопительной статистики
      const statsJson = execSync(
        "docker stats --no-stream --format '{{json .}}' mtproxy 2>/dev/null",
        { timeout: 5000 }
      ).toString().trim();
      
      if (statsJson) {
        const stats = JSON.parse(statsJson);
        const netIO = stats.NetIO || '';
        
        // Формат: "1.2MB / 3.4MB" или "1.2GB / 3.4GB"
        const [rxStr, txStr] = netIO.split(' / ');
        
        let rxMb = 0;
        let txMb = 0;
        
        if (rxStr) {
          const rxValue = parseFloat(rxStr.replace(/[^0-9.]/g, '')) || 0;
          rxMb = rxStr.includes('GB') ? rxValue * 1024 : rxValue;
          if (rxStr.includes('kB') || rxStr.includes('KB')) rxMb = rxValue / 1024;
        }
        
        if (txStr) {
          const txValue = parseFloat(txStr.replace(/[^0-9.]/g, '')) || 0;
          txMb = txStr.includes('GB') ? txValue * 1024 : txValue;
          if (txStr.includes('kB') || txStr.includes('KB')) txMb = txValue / 1024;
        }
        
        return { inMb: rxMb, outMb: txMb };
      }
    } catch (e) {
      // Последний fallback
    }
    
    return { inMb: 0, outMb: 0 };
  } catch {
    return { inMb: 0, outMb: 0 };
  }
}

// ═══════════════════════════════════════════════
// START SERVER
// ═══════════════════════════════════════════════

const PORT = parseInt(process.env.API_PORT || '8080');

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Node Agent API listening on port ${PORT}`);
  console.log(`Domain: ${DOMAIN}`);
  console.log(`MTProto Port: ${MTPROTO_PORT}`);
  console.log(`SOCKS5 Port: ${SOCKS5_PORT}`);
  console.log(`Workers: ${WORKERS}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  process.exit(0);
});
