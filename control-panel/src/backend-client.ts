import { cache } from './cache';

export interface BackendConfig {
  baseUrl: string;
  token: string;
}

export interface BackendUser {
  uuid: string;
  username: string;
  shortUuid?: string;
  telegramId?: number | null;
}

export interface AccessibleNode {
  id: string;
  name?: string;
}

export class BackendClient {
  private cfg: BackendConfig;

  constructor(cfg: BackendConfig) {
    this.cfg = cfg;
  }

  private async request<T>(method: string, path: string, useCache: boolean = false, cacheTtl: number = 60): Promise<T> {
    // Проверка кэша для GET запросов
    if (useCache && method === 'GET') {
      const cached = await cache.get<T>(`backend:${path}`);
      if (cached !== null) {
        return cached;
      }
    }

    const url = `${this.cfg.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.cfg.token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Backend API error ${res.status}: ${text}`);
    }
    const data = await res.json() as T;
    
    // Сохранение в кэш
    if (useCache && method === 'GET') {
      await cache.set(`backend:${path}`, data, cacheTtl);
    }
    
    return data;
  }

  async getUserByTelegramId(telegramId: number): Promise<BackendUser> {
    return this.request('GET', `/api/users/by-telegram-id/${telegramId}`, true, 300); // Кэш 5 минут
  }

  async getUserByUsername(username: string): Promise<BackendUser> {
    return this.request('GET', `/api/users/by-username/${encodeURIComponent(username)}`, true, 300);
  }

  async getUserByShortUuid(shortUuid: string): Promise<BackendUser> {
    return this.request('GET', `/api/users/by-short-uuid/${encodeURIComponent(shortUuid)}`, true, 300);
  }

  async getAccessibleNodes(userUuid: string): Promise<{ nodes: AccessibleNode[] } | any> {
    // Кэшируем на 2 минуты (часто вызывается в cron)
    return this.request('GET', `/api/users/${userUuid}/accessible-nodes`, true, 120);
  }
}

export function getBackendClientFromEnv(): BackendClient | null {
  const baseUrl = process.env.BACKEND_BASE_URL || '';
  const token = process.env.BACKEND_TOKEN || '';
  if (!baseUrl || !token) {
    // Backend не обязателен - используется только для интеграции с веб-приложением
    return null;
  }
  return new BackendClient({ baseUrl, token });
}


