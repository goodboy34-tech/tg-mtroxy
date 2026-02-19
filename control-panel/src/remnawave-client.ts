/**
 * Прямой клиент для Remnawave API (панель управления Xray).
 * Используется для проверки подписок пользователей напрямую через Remnawave API.
 */

export interface RemnawaveConfig {
  baseUrl: string; // URL панели Remnawave (например, https://panel.example.com)
  token: string;   // API токен из Remnawave панели
}

export interface RemnawaveUser {
  uuid: string;
  shortUuid?: string;
  username?: string;
  telegramId?: number | null;
  expireAt?: string | null;
}

export interface RemnawaveNode {
  id: string;
  name?: string;
  address?: string;
}

/**
 * Клиент для работы с Remnawave API напрямую.
 * Использует официальный формат запросов Remnawave.
 */
export class RemnawaveClient {
  private cfg: RemnawaveConfig;

  constructor(cfg: RemnawaveConfig) {
    this.cfg = cfg;
  }

  private async request<T>(method: string, path: string, body?: any): Promise<T> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}${path}`;
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${this.cfg.token}`,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const res = await fetch(url, options);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Remnawave API error ${res.status}: ${text}`);
    }
    return await res.json() as T;
  }

  /**
   * Получить пользователя по Telegram ID через Remnawave API.
   * Если Remnawave не поддерживает прямой поиск по tg-id, используем ваш backend (api-1.yaml).
   */
  async getUserByTelegramId(telegramId: number): Promise<RemnawaveUser | null> {
    try {
      // Попытка прямого запроса к Remnawave (если поддерживается)
      return await this.request('GET', `/api/users/by-telegram-id/${telegramId}`);
    } catch (err: any) {
      // Если не поддерживается - возвращаем null, будет использован backend
      console.warn(`[Remnawave] Direct telegramId lookup not supported: ${err.message}`);
      return null;
    }
  }

  /**
   * Получить пользователя по username.
   */
  async getUserByUsername(username: string): Promise<RemnawaveUser | null> {
    try {
      return await this.request('GET', `/api/users/by-username/${encodeURIComponent(username)}`);
    } catch (err: any) {
      console.warn(`[Remnawave] Username lookup failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Получить пользователя по short UUID.
   */
  async getUserByShortUuid(shortUuid: string): Promise<RemnawaveUser | null> {
    try {
      return await this.request('GET', `/api/users/by-short-uuid/${encodeURIComponent(shortUuid)}`);
    } catch (err: any) {
      console.warn(`[Remnawave] ShortUuid lookup failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Получить список доступных нод для пользователя (проверка активных подписок).
   */
  async getAccessibleNodes(userUuid: string): Promise<RemnawaveNode[]> {
    try {
      const result = await this.request<any>('GET', `/api/users/${userUuid}/accessible-nodes`);
      return result?.nodes || result?.data?.nodes || result?.accessibleNodes || [];
    } catch (err: any) {
      console.warn(`[Remnawave] Accessible nodes lookup failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Проверить, есть ли у пользователя активные подписки (есть доступные ноды).
   */
  async hasActiveSubscription(userUuid: string): Promise<boolean> {
    const nodes = await this.getAccessibleNodes(userUuid);
    return Array.isArray(nodes) && nodes.length > 0;
  }
}

/**
 * Получить клиент Remnawave из переменных окружения.
 * Если не настроен - возвращает null (будет использован backend через api-1.yaml).
 */
export function getRemnawaveClientFromEnv(): RemnawaveClient | null {
  const baseUrl = process.env.REMNAWAVE_BASE_URL || '';
  const token = process.env.REMNAWAVE_TOKEN || '';
  if (!baseUrl || !token) {
    return null; // Используем backend вместо прямого Remnawave API
  }
  return new RemnawaveClient({ baseUrl, token });
}

