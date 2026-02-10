import crypto from 'crypto';
import { queries } from './database';
import { NodeApiClient, ProxyLinkGenerator } from './node-client';

/**
 * Менеджер подписок для управления доступами к прокси
 */
export class SubscriptionManager {
  /**
   * Создать новую подписку
   */
  static async createSubscription(
    name: string,
    description: string,
    nodeIds: number[],
    includeMtproto: boolean = true,
    includeSocks5: boolean = true
  ): Promise<number> {
    // Генерируем уникальный URL для подписки
    const subscriptionUrl = `sub_${crypto.randomBytes(16).toString('hex')}`;

    const result = queries.insertSubscription.run({
      name,
      description,
      node_ids: JSON.stringify(nodeIds),
      include_mtproto: includeMtproto ? 1 : 0,
      include_socks5: includeSocks5 ? 1 : 0,
      subscription_url: subscriptionUrl
    }) as { lastInsertRowid: number };

    return result.lastInsertRowid;
  }

  /**
   * Получить все прокси для подписки
   */
  static async getSubscriptionProxies(subscriptionId: number): Promise<Array<{
    type: 'mtproto' | 'socks5';
    node: any;
    secret?: string;
    isFakeTls?: boolean;
    username?: string;
    password?: string;
  }>> {
    const sub = queries.getSubscriptionById.get(subscriptionId) as any;
    
    if (!sub) {
      throw new Error('Subscription not found');
    }

    const nodeIds = JSON.parse(sub.node_ids) as number[];
    const proxies: Array<any> = [];

    for (const nodeId of nodeIds) {
      const node = queries.getNodeById.get(nodeId) as any;
      
      if (!node || node.status !== 'online') {
        continue;
      }

      // Получаем MTProto секреты
      if (sub.include_mtproto) {
        const secrets = queries.getActiveSecretsForNode.all(nodeId) as any[];
        
        for (const secret of secrets) {
          proxies.push({
            type: 'mtproto',
            node,
            secret: secret.secret,
            isFakeTls: secret.is_fake_tls === 1
          });
        }
      }

      // Получаем SOCKS5 аккаунты
      if (sub.include_socks5) {
        const accounts = queries.getActiveSocks5Accounts.all(nodeId) as any[];
        
        for (const account of accounts) {
          proxies.push({
            type: 'socks5',
            node,
            username: account.username,
            password: account.password
          });
        }
      }
    }

    return proxies;
  }

  /**
   * Генерировать ссылки для подписки
   */
  static generateSubscriptionLinks(proxies: Array<any>): string[] {
    const links: string[] = [];

    for (const proxy of proxies) {
      if (proxy.type === 'mtproto') {
        // Генерируем tg:// ссылку для MTProto
        const link = ProxyLinkGenerator.generateMtProtoLink(
          proxy.node.domain,
          proxy.node.mtproto_port,
          proxy.secret
        );
        links.push(link);
      } else if (proxy.type === 'socks5') {
        // Генерируем tg:// ссылку для SOCKS5
        const link = ProxyLinkGenerator.generateSocks5TgLink(
          proxy.node.domain,
          proxy.node.socks5_port,
          proxy.username,
          proxy.password
        );
        links.push(link);
      }
    }

    return links;
  }

  /**
   * Генерировать JSON для импорта в Telegram
   */
  static async generateTelegramImportJson(subscriptionId: number): Promise<any> {
    const proxies = await this.getSubscriptionProxies(subscriptionId);
    const sub = queries.getSubscriptionById.get(subscriptionId) as any;

    const proxyList: any[] = [];

    for (const proxy of proxies) {
      if (proxy.type === 'mtproto') {
        proxyList.push({
          _: 'inputMediaProxyServer',
          server: proxy.node.domain,
          port: proxy.node.mtproto_port,
          secret: proxy.secret
        });
      } else if (proxy.type === 'socks5') {
        proxyList.push({
          _: 'inputMediaProxyServer',
          server: proxy.node.domain,
          port: proxy.node.socks5_port,
          username: proxy.username,
          password: proxy.password,
          type: 'socks5'
        });
      }
    }

    return {
      name: sub.name,
      description: sub.description,
      proxies: proxyList
    };
  }

  /**
   * Переключить статус подписки
   */
  static async toggleSubscription(subscriptionId: number): Promise<void> {
    const sub = queries.getSubscriptionById.get(subscriptionId) as any;
    
    if (!sub) {
      throw new Error('Subscription not found');
    }

    if (sub.is_active) {
      queries.deactivateSubscription.run(subscriptionId);
    } else {
      queries.activateSubscription.run(subscriptionId);
    }
  }

  /**
   * Обновить подписку
   */
  static async updateSubscription(
    subscriptionId: number,
    updates: {
      name?: string;
      description?: string;
      nodeIds?: number[];
      includeMtproto?: boolean;
      includeSocks5?: boolean;
    }
  ): Promise<void> {
    const sub = queries.getSubscriptionById.get(subscriptionId) as any;
    
    if (!sub) {
      throw new Error('Subscription not found');
    }

    queries.updateSubscription.run({
      id: subscriptionId,
      name: updates.name ?? sub.name,
      description: updates.description ?? sub.description,
      node_ids: updates.nodeIds ? JSON.stringify(updates.nodeIds) : sub.node_ids,
      include_mtproto: updates.includeMtproto !== undefined ? (updates.includeMtproto ? 1 : 0) : sub.include_mtproto,
      include_socks5: updates.includeSocks5 !== undefined ? (updates.includeSocks5 ? 1 : 0) : sub.include_socks5
    });
  }

  /**
   * Удалить подписку
   */
  static async deleteSubscription(subscriptionId: number): Promise<void> {
    queries.deleteSubscription.run(subscriptionId);
  }

  /**
   * Получить статистику подписки
   */
  static getSubscriptionStats(subscriptionId: number): {
    totalProxies: number;
    mtprotoCount: number;
    socks5Count: number;
    accessCount: number;
  } {
    const sub = queries.getSubscriptionById.get(subscriptionId) as any;
    
    if (!sub) {
      throw new Error('Subscription not found');
    }

    const nodeIds = JSON.parse(sub.node_ids) as number[];
    let mtprotoCount = 0;
    let socks5Count = 0;

    for (const nodeId of nodeIds) {
      if (sub.include_mtproto) {
        const secrets = queries.getActiveSecretsForNode.all(nodeId) as any[];
        mtprotoCount += secrets.length;
      }

      if (sub.include_socks5) {
        const accounts = queries.getActiveSocks5Accounts.all(nodeId) as any[];
        socks5Count += accounts.length;
      }
    }

    return {
      totalProxies: mtprotoCount + socks5Count,
      mtprotoCount,
      socks5Count,
      accessCount: sub.access_count
    };
  }
}

/**
 * Форматтер для отображения подписок в Telegram
 */
export class SubscriptionFormatter {
  /**
   * Форматировать список прокси для Telegram
   */
  static formatProxiesForTelegram(proxies: Array<any>): string {
    if (proxies.length === 0) {
      return '_(пусто)_';
    }

    let text = '';
    let mtprotoCount = 0;
    let socks5Count = 0;

    for (const proxy of proxies) {
      if (proxy.type === 'mtproto') {
        mtprotoCount++;
      } else if (proxy.type === 'socks5') {
        socks5Count++;
      }
    }

    text += `MTProto: ${mtprotoCount}\n`;
    text += `SOCKS5: ${socks5Count}\n`;
    text += `Всего: ${proxies.length}`;

    return text;
  }

  /**
   * Форматировать информацию о подписке
   */
  static formatSubscriptionInfo(sub: any, proxyCount: number): string {
    const status = sub.is_active ? '🟢 Активна' : '🔴 Неактивна';
    const nodeIds = JSON.parse(sub.node_ids || '[]');

    let text = `📋 *${sub.name}*\n\n`;
    text += `ID: \`${sub.id}\`\n`;
    text += `Статус: ${status}\n`;
    text += `Нод: ${nodeIds.length}\n`;
    text += `Прокси: ${proxyCount}\n`;
    text += `MTProto: ${sub.include_mtproto ? '✅' : '❌'}\n`;
    text += `SOCKS5: ${sub.include_socks5 ? '✅' : '❌'}\n`;
    text += `Обращений: ${sub.access_count}\n`;
    
    if (sub.description) {
      text += `\n${sub.description}\n`;
    }

    return text;
  }
}
