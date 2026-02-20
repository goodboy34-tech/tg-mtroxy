import express from 'express';
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
const AD_TAG = process.env.AD_TAG || '';

// MTProxy образ (рекомендуется skrashevich/mtproxy для TLS маскировки)
const MT_PROXY_IMAGE = process.env.MT_PROXY_IMAGE || 'skrashevich/mtproxy:latest';
const ENABLE_SOCKS5 = (process.env.ENABLE_SOCKS5 || 'true').toLowerCase() !== 'false';
const MT_DOCKER_RUN_ARGS = process.env.MT_DOCKER_RUN_ARGS || '';
const SOCKS5_DOCKER_RUN_ARGS = process.env.SOCKS5_DOCKER_RUN_ARGS || '';

// TLS маскировка (для обхода цензуры)
const TLS_DOMAIN = process.env.TLS_DOMAIN || '';
const TLS_CERT_PATH = process.env.TLS_CERT_PATH || '';
const TLS_KEY_PATH = process.env.TLS_KEY_PATH || '';

const DATA_DIR = path.join(__dirname, '..', 'data');
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');
const SOCKS5_USERS_FILE = path.join(DATA_DIR, 'socks5-users.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ═══════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════

function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
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

function isContainerRunning(name: string): boolean {
    try {
        const result = execSync(`docker ps --filter name=${name} --format "{{.Names}}"`).toString().trim();
        return result === name;
    } catch {
        return false;
    }
}

async function getCpuUsage(): Promise<number> {
    try {
        const result = await execAsync("top -bn1 | grep 'Cpu(s)' | sed 's/.*, *\\([0-9.]*\\)%* id.*/\\1/' | awk '{print 100 - $1}'");
        return parseFloat(result.stdout.trim()) || 0;
    } catch {
        return 0;
    }
}

async function getRamUsage(): Promise<number> {
    try {
        const result = await execAsync("free | grep Mem | awk '{printf \"%.1f\", ($3/$2) * 100.0}'");
        return parseFloat(result.stdout.trim()) || 0;
    } catch {
        return 0;
    }
}

async function getDiskUsage(): Promise<number> {
    try {
        const result = await execAsync("df -h / | tail -1 | awk '{print $5}' | sed 's/%//'");
        return parseFloat(result.stdout.trim()) || 0;
    } catch {
        return 0;
    }
}

function getUptime(): number {
    try {
        return Math.floor(process.uptime());
    } catch {
        return 0;
    }
}

app.get('/health', async (req, res) => {
    try {
        const mtprotoRunning = isContainerRunning('mtproxy');
        const socks5Running = ENABLE_SOCKS5 ? isContainerRunning('mtproxy-socks5') : false;
        const cpuUsage = await getCpuUsage();
        const ramUsage = await getRamUsage();
        const diskUsage = await getDiskUsage();
        const uptime = getUptime();

        res.json({
            status: 'healthy',
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

async function getMtProtoStats(): Promise<any> {
    try {
        const result = await execAsync('docker exec mtproxy curl -s http://localhost:2398/stats 2>/dev/null || echo "{}"');
        return JSON.parse(result.stdout || '{}');
    } catch {
        return { connections: 0, maxConnections: 0 };
    }
}

async function getSocks5Stats(): Promise<any> {
    try {
        const result = await execAsync('docker exec mtproxy-socks5 netstat -an | grep ESTABLISHED | wc -l');
        return { connections: parseInt(result.stdout.trim()) || 0 };
    } catch {
        return { connections: 0 };
    }
}

async function getNetworkStats(): Promise<any> {
    try {
        const result = await execAsync('cat /proc/net/dev | grep eth0 | awk \'{print $2, $10}\'');
        const parts = result.stdout.trim().split(/\s+/);
        return {
            inMb: Math.round(parseInt(parts[0] || '0') / 1024 / 1024),
            outMb: Math.round(parseInt(parts[1] || '0') / 1024 / 1024),
        };
    } catch {
        return { inMb: 0, outMb: 0 };
    }
}

async function getMtProtoSecretsStats(): Promise<any> {
    try {
        // skrashevich/MTProxy поддерживает per-secret статистику через /stats
        const result = await execAsync('docker exec mtproxy curl -s http://localhost:2398/stats 2>/dev/null || echo "{}"');
        const stats = JSON.parse(result.stdout || '{}');
        
        // Если есть per-secret статистика, возвращаем её
        if (stats.secrets && Array.isArray(stats.secrets)) {
            return stats.secrets;
        }
        
        // Иначе возвращаем пустой массив
        return [];
    } catch {
        return [];
    }
}

app.get('/stats', async (req, res) => {
    try {
        const mtprotoStats = await getMtProtoStats();
        const socks5Stats = ENABLE_SOCKS5 ? await getSocks5Stats() : { connections: 0 };
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

app.get('/mtproto/secrets/stats', async (req, res) => {
    try {
        const mtprotoStats = await getMtProtoStats();
        const secretsStats = await getMtProtoSecretsStats();
        const secrets = loadSecrets();
        res.json({
            aggregate: mtprotoStats,
            bySecret: secretsStats,
            secretsCount: secrets.length,
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ═══════════════════════════════════════════════
// MTPROTO MANAGEMENT
// ═══════════════════════════════════════════════

interface Secret {
    secret: string;
    isFakeTls: boolean;
    description: string;
}

function loadSecrets(): Secret[] {
    if (!fs.existsSync(SECRETS_FILE)) {
        return [];
    }
    return JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
}

function saveSecrets(secrets: Secret[]): void {
    fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2));
}

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

async function restartMtProto(): Promise<void> {
    const secrets = loadSecrets();
    
    if (secrets.length === 0) {
        console.log('[MTProto] No secrets, stopping container');
        execSync('docker stop mtproxy || true');
        return;
    }
    
    // Формируем строку секретов для MTProxy
    // skrashevich/MTProxy требует префикс "dd" для fake TLS секретов
    // Секреты хранятся БЕЗ префикса, но при передаче в MTProxy нужно добавить "dd" если isFakeTls = true
    const secretsStr = secrets.map(s => {
        // Если это fake TLS секрет - добавляем префикс "dd"
        return s.isFakeTls ? `dd${s.secret}` : s.secret;
    }).join(',');
    
    console.log(`[MTProto] Restarting with ${secrets.length} secrets (${secrets.filter(s => s.isFakeTls).length} fake-TLS), ${WORKERS} workers`);
    
    // Останавливаем старый контейнер
    execSync('docker stop mtproxy || true');
    execSync('docker rm mtproxy || true');
    
    // Формируем команду запуска
    let cmd = 'docker run -d --name=mtproxy --restart=unless-stopped ' +
        `-p ${MTPROTO_PORT}:443 -p 2398:2398 ` +
        `-e SECRET=${secretsStr} ` +
        `-e WORKERS=${WORKERS} `;
    
    // Если есть NAT info
    if (INTERNAL_IP && DOMAIN) {
        cmd += `-e NAT_INFO=${INTERNAL_IP}:${DOMAIN} `;
    }
    
    // Если есть AD_TAG (рекламный тег)
    if (AD_TAG) {
        cmd += `-e TAG=${AD_TAG} `;
        console.log(`[MTProto] Using AD_TAG: ${AD_TAG}`);
    }
    
    // TLS маскировка (для обхода цензуры)
    if (TLS_DOMAIN && TLS_CERT_PATH && TLS_KEY_PATH) {
        // Проверяем существование файлов сертификатов
        if (fs.existsSync(TLS_CERT_PATH) && fs.existsSync(TLS_KEY_PATH)) {
            // Монтируем сертификаты в контейнер
            cmd += `-v ${TLS_CERT_PATH}:/data/tls/cert.pem:ro `;
            cmd += `-v ${TLS_KEY_PATH}:/data/tls/key.pem:ro `;
            cmd += `-e TLS_DOMAIN=${TLS_DOMAIN} `;
            cmd += `-e TLS_CERT=/data/tls/cert.pem `;
            cmd += `-e TLS_KEY=/data/tls/key.pem `;
            console.log(`[MTProto] Using TLS masking for domain: ${TLS_DOMAIN}`);
        } else {
            console.warn(`[MTProto] TLS certificates not found: ${TLS_CERT_PATH} or ${TLS_KEY_PATH}`);
        }
    }
    
    // Доп. параметры docker run (лимиты, ulimit, логирование и т.п.)
    if (MT_DOCKER_RUN_ARGS) {
        cmd += `${MT_DOCKER_RUN_ARGS} `;
    }
    
    // Образ MTProto-прокси
    cmd += MT_PROXY_IMAGE;
    
    execSync(cmd);
    console.log('[MTProto] Container restarted');
}

// ═══════════════════════════════════════════════
// SOCKS5 MANAGEMENT (упрощенная версия)
// ═══════════════════════════════════════════════

interface Socks5Account {
    username: string;
    password: string;
    description: string;
}

function loadSocks5Accounts(): Socks5Account[] {
    if (!fs.existsSync(SOCKS5_USERS_FILE)) {
        return [];
    }
    return JSON.parse(fs.readFileSync(SOCKS5_USERS_FILE, 'utf8'));
}

function saveSocks5Accounts(accounts: Socks5Account[]): void {
    fs.writeFileSync(SOCKS5_USERS_FILE, JSON.stringify(accounts, null, 2));
}

app.get('/socks5/accounts', (req, res) => {
    if (!ENABLE_SOCKS5) {
        return res.status(403).json({ error: 'SOCKS5 is disabled on this node' });
    }
    const accounts = loadSocks5Accounts();
    res.json(accounts);
});

app.post('/socks5/accounts', async (req, res) => {
    try {
        if (!ENABLE_SOCKS5) {
            return res.status(403).json({ error: 'SOCKS5 is disabled on this node' });
        }
        const { username, password, description } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }
        const accounts = loadSocks5Accounts();
        if (accounts.find(a => a.username === username)) {
            return res.status(400).json({ error: 'Username already exists' });
        }
        accounts.push({ username, password, description: description || '' });
        saveSocks5Accounts(accounts);
        await updateSocks5Config(accounts);
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/socks5/accounts/:username', async (req, res) => {
    try {
        if (!ENABLE_SOCKS5) {
            return res.status(403).json({ error: 'SOCKS5 is disabled on this node' });
        }
        const { username } = req.params;
        let accounts = loadSocks5Accounts();
        const initialLength = accounts.length;
        accounts = accounts.filter(a => a.username !== username);
        if (accounts.length === initialLength) {
            return res.status(404).json({ error: 'Account not found' });
        }
        saveSocks5Accounts(accounts);
        await updateSocks5Config(accounts);
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

async function restartSocks5(): Promise<void> {
    console.log('[SOCKS5] Restarting container');
    if (!ENABLE_SOCKS5) {
        console.log('[SOCKS5] Disabled, skipping restart');
        return;
    }
    execSync('docker restart mtproxy-socks5');
    console.log('[SOCKS5] Container restarted');
}

async function updateSocks5Config(accounts: Socks5Account[]): Promise<void> {
    console.log(`[SOCKS5] Updating GOST config with ${accounts.length} accounts`);
    if (!ENABLE_SOCKS5) {
        console.log('[SOCKS5] Disabled, skipping config update');
        return;
    }
    
    try {
        execSync('docker stop mtproxy-socks5 || true');
        execSync('docker rm mtproxy-socks5 || true');
    } catch {
        console.log('[SOCKS5] No existing container to remove');
    }
    
    if (accounts.length === 0) {
        console.log('[SOCKS5] No accounts, SOCKS5 disabled');
        return;
    }
    
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
    
    const configPath = path.join(DATA_DIR, 'gost.json');
    fs.writeFileSync(configPath, JSON.stringify(gostConfig, null, 2));
    
    let cmd = `docker run -d --name=mtproxy-socks5 --restart=unless-stopped ` +
        `-p ${SOCKS5_PORT}:${SOCKS5_PORT} ` +
        `-v ${configPath}:/etc/gost/config.json:ro `;
    
    if (SOCKS5_DOCKER_RUN_ARGS) {
        cmd += `${SOCKS5_DOCKER_RUN_ARGS} `;
    }
    
    cmd += 'ginuerzh/gost:latest -C /etc/gost/config.json';
    
    execSync(cmd);
    console.log('[SOCKS5] Container restarted');
}

app.post('/socks5/restart', async (req, res) => {
    try {
        if (!ENABLE_SOCKS5) {
            return res.status(403).json({ error: 'SOCKS5 is disabled on this node' });
        }
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
        const socks5Logs = ENABLE_SOCKS5
            ? execSync(`docker logs --tail ${lines} mtproxy-socks5 2>&1`).toString()
            : '[SOCKS5 disabled]';
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

// ═══════════════════════════════════════════════
// SERVER START
// ═══════════════════════════════════════════════

const PORT = 8080;
app.listen(PORT, () => {
    console.log(`Node Agent API запущен на порту ${PORT}`);
    if (TLS_DOMAIN && TLS_CERT_PATH && TLS_KEY_PATH) {
        console.log(`TLS маскировка включена для домена: ${TLS_DOMAIN}`);
    }
});

