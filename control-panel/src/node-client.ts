import https from 'https';
import fs from 'fs';
import path from 'path';

/**
 * Клиент для взаимодействия с Node Agent API
 * Поддерживает mTLS и Bearer Token аутентификацию
 */

export interface NodeConfig {
  id: number;
  name: string;
  apiUrl: string;
  apiToken: string;
  useMtls?: boolean;
  certPath?: string;
  keyPath?: string;
  caPath?: string;
}

export interface NodeHealth {
  status: 'healthy' | 'unhealthy';
  uptime: number;
  mtproto: {
    running: boolean;
    workers: number;
  };
  socks5: {
    running: boolean;
  };
  system: {
    cpuUsage: number;
    ramUsage: number;
    diskUsage: number;
  };
}

export interface NodeStats {
  mtproto: {
    connections: number;
    maxConnections: number;
    readyTargets: number;
    activeTargets: number;
  };
  socks5: {
    connections: number;
  };
  network: {
    inMb: number;
    outMb: number;
  };
}

export interface MtProtoSecret {
  secret: string;
  isFakeTls: boolean;
  description?: string;
}

export interface Socks5Account {
  username: string;
  password: string;
  description?: string;
}

export class NodeApiClient {
  private config: NodeConfig;
  private httpsAgent?: https.Agent;

  constructor(config: NodeConfig) {
    this.config = config;
    
    // Настройка mTLS если включено
    if (config.useMtls && config.certPath && config.keyPath && config.caPath) {
      this.httpsAgent = new https.Agent({
        cert: fs.readFileSync(config.certPath),
        key: fs.readFileSync(config.keyPath),
        ca: fs.readFileSync(config.caPath),
        rejectUnauthorized: true,
      });
    }
  }

  /**
   * Выполнить HTTP запрос к ноде
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: any
  ): Promise<T> {
    const url = `${this.config.apiUrl}${endpoint}`;
    
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiToken}`,
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    // Добавляем mTLS agent если настроен
    if (this.httpsAgent) {
      (options as any).agent = this.httpsAgent;
    }

    try {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Node API error: ${response.status} - ${error}`);
      }

      return await response.json() as T;
    } catch (error: any) {
      throw new Error(`Failed to connect to node ${this.config.name}: ${error.message}`);
    }
  }

  // ═══════════════════════════════════════════════
  // HEALTH & STATUS
  // ═══════════════════════════════════════════════

  async getHealth(): Promise<NodeHealth> {
    return this.request<NodeHealth>('GET', '/health');
  }

  async getStats(): Promise<NodeStats> {
    return this.request<NodeStats>('GET', '/stats');
  }

  async ping(): Promise<{ pong: boolean; timestamp: number }> {
    return this.request('GET', '/ping');
  }

  // ═══════════════════════════════════════════════
  // MTPROTO MANAGEMENT
  // ═══════════════════════════════════════════════

  async addMtProtoSecret(secret: MtProtoSecret): Promise<{ success: boolean }> {
    return this.request('POST', '/mtproto/secrets', secret);
  }

  async removeMtProtoSecret(secret: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/mtproto/secrets/${secret}`);
  }

  async getMtProtoSecrets(): Promise<MtProtoSecret[]> {
    return this.request('GET', '/mtproto/secrets');
  }

  async restartMtProto(): Promise<{ success: boolean }> {
    return this.request('POST', '/mtproto/restart');
  }

  async updateMtProtoWorkers(workers: number): Promise<{ success: boolean }> {
    return this.request('POST', '/mtproto/workers', { workers });
  }

  async updateMtProtoConfig(config: {
    workers?: number;
    tag?: string;
    natInfo?: string;
  }): Promise<{ success: boolean }> {
    return this.request('POST', '/mtproto/config', config);
  }

  async updateAdTag(tag: string | null): Promise<{ success: boolean }> {
    return this.request('POST', '/mtproto/config', { tag: tag || undefined });
  }

  // ═══════════════════════════════════════════════
  // SOCKS5 MANAGEMENT
  // ═══════════════════════════════════════════════

  async addSocks5Account(account: Socks5Account): Promise<{ success: boolean }> {
    return this.request('POST', '/socks5/accounts', account);
  }

  async removeSocks5Account(username: string): Promise<{ success: boolean }> {
    return this.request('DELETE', `/socks5/accounts/${username}`);
  }

  async getSocks5Accounts(): Promise<Socks5Account[]> {
    return this.request('GET', '/socks5/accounts');
  }

  async restartSocks5(): Promise<{ success: boolean }> {
    return this.request('POST', '/socks5/restart');
  }

  // ═══════════════════════════════════════════════
  // SYSTEM MANAGEMENT
  // ═══════════════════════════════════════════════

  async executeScript(script: string): Promise<{ 
    success: boolean; 
    output: string;
    exitCode: number;
  }> {
    return this.request('POST', '/system/execute', { script });
  }

  async getLogs(lines: number = 100): Promise<{
    mtproto: string;
    socks5: string;
    agent: string;
  }> {
    return this.request('GET', `/system/logs?lines=${lines}`);
  }

  async updateProxyFiles(): Promise<{ success: boolean }> {
    return this.request('POST', '/system/update-proxy-files');
  }

  async updateWorkers(workers: number): Promise<{ success: boolean }> {
    return this.request('POST', '/mtproto/workers', { workers });
  }

  async rebootNode(): Promise<{ success: boolean }> {
    return this.request('POST', '/system/reboot');
  }
}

/**
 * Генератор ссылок для подключения к прокси
 */
export class ProxyLinkGenerator {
  /**
   * Генерирует tg:// ссылку для MTProto
   */
  static generateMtProtoLink(
    domain: string,
    port: number,
    secret: string,
    isFakeTls: boolean = true
  ): string {
    const prefix = isFakeTls ? 'dd' : '';
    return `tg://proxy?server=${domain}&port=${port}&secret=${prefix}${secret}`;
  }

  /**
   * Генерирует t.me ссылку для MTProto
   */
  static generateMtProtoWebLink(
    domain: string,
    port: number,
    secret: string,
    isFakeTls: boolean = true
  ): string {
    const prefix = isFakeTls ? 'dd' : '';
    return `https://t.me/proxy?server=${domain}&port=${port}&secret=${prefix}${secret}`;
  }

  /**
   * Генерирует SOCKS5 URI
   */
  static generateSocks5Link(
    domain: string,
    port: number,
    username: string,
    password: string
  ): string {
    const auth = username && password ? `${username}:${password}@` : '';
    return `socks5://${auth}${domain}:${port}`;
  }

  /**
   * Генерирует tg:// ссылку для SOCKS5 прокси (для Telegram)
   */
  static generateSocks5TgLink(
    domain: string,
    port: number,
    username: string,
    password: string
  ): string {
    const userParam = username ? `&user=${encodeURIComponent(username)}` : '';
    const passParam = password ? `&pass=${encodeURIComponent(password)}` : '';
    return `tg://socks?server=${domain}&port=${port}${userParam}${passParam}`;
  }

  /**
   * Генерирует t.me ссылку для SOCKS5 прокси (для Telegram)
   */
  static generateSocks5TmeLink(
    domain: string,
    port: number,
    username: string,
    password: string
  ): string {
    const userParam = username ? `&user=${encodeURIComponent(username)}` : '';
    const passParam = password ? `&pass=${encodeURIComponent(password)}` : '';
    return `https://t.me/socks?server=${domain}&port=${port}${userParam}${passParam}`;
  }

  /**
   * Генерирует QR-код (возвращает base64 PNG)
   */
  static async generateQrCode(text: string): Promise<string> {
    // TODO: Реализовать генерацию QR кода (используя библиотеку qrcode)
    return 'base64-qr-code-placeholder';
  }
}

/**
 * Генератор секретов
 */
export class SecretGenerator {
  /**
   * Генерирует случайный MTProto секрет (16 байт = 32 hex символа)
   */
  static generateMtProtoSecret(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Генерирует случайный пароль для SOCKS5
   */
  static generatePassword(length: number = 16): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map(b => chars[b % chars.length])
      .join('');
  }

  /**
   * Генерирует Bearer Token для API
   */
  static generateApiToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
