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

  private async request<T>(method: string, path: string): Promise<T> {
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
    return await res.json() as T;
  }

  async getUserByTelegramId(telegramId: number): Promise<BackendUser> {
    return this.request('GET', `/api/users/by-telegram-id/${telegramId}`);
  }

  async getUserByUsername(username: string): Promise<BackendUser> {
    return this.request('GET', `/api/users/by-username/${encodeURIComponent(username)}`);
  }

  async getUserByShortUuid(shortUuid: string): Promise<BackendUser> {
    return this.request('GET', `/api/users/by-short-uuid/${encodeURIComponent(shortUuid)}`);
  }

  async getAccessibleNodes(userUuid: string): Promise<{ nodes: AccessibleNode[] } | any> {
    return this.request('GET', `/api/users/${userUuid}/accessible-nodes`);
  }
}

export function getBackendClientFromEnv(): BackendClient {
  const baseUrl = process.env.BACKEND_BASE_URL || '';
  const token = process.env.BACKEND_TOKEN || '';
  if (!baseUrl || !token) {
    throw new Error('BACKEND_BASE_URL и BACKEND_TOKEN обязательны для интеграции с backend (api-1.yaml)');
  }
  return new BackendClient({ baseUrl, token });
}


