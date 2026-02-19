/**
 * Менеджер продаж MTProxy
 * Объединяет логику продаж с системой нод
 */

import { queries } from './database';
import { MtprotoUserManager } from './mtproto-user-manager';
import { SubscriptionManager } from './subscription-manager';
import { Product } from './products';
import crypto from 'crypto';

export interface OrderResult {
  success: boolean;
  orderId?: number;
  links?: string[];
  error?: string;
}

export class SalesManager {
  /**
   * Создать заказ и выдать MTProto на нескольких нодах
   */
  static async createOrder(params: {
    telegramId: number;
    productId: number;
    paymentMethod: string;
    paymentId: string;
    amount: number;
  }): Promise<OrderResult> {
    const { telegramId, productId, paymentMethod, paymentId, amount } = params;

    const product = queries.getProductById.get(productId) as any;
    if (!product || !product.is_active) {
      return { success: false, error: 'Продукт не найден или неактивен' };
    }

    // Вычисляем дату окончания
    let expiresAt: Date;
    if (product.minutes && product.minutes > 0) {
      expiresAt = new Date(Date.now() + product.minutes * 60000);
    } else {
      expiresAt = new Date(Date.now() + product.days * 86400000);
    }

    // Выбираем ноды для выдачи (балансировка нагрузки)
    const activeNodes = queries.getActiveNodes.all() as any[];
    if (activeNodes.length === 0) {
      return { success: false, error: 'Нет доступных нод' };
    }

    // Выбираем нужное количество нод (или все доступные, если меньше)
    const nodeCount = Math.min(product.node_count || 1, activeNodes.length);
    const selectedNodes = this.selectNodesForUser(activeNodes, nodeCount);

    if (selectedNodes.length === 0) {
      return { success: false, error: 'Не удалось выбрать ноды' };
    }

    const nodeIds = selectedNodes.map(n => n.id);

    // Создаем локальную подписку для пользователя
    const subscriptionName = `Sale-${telegramId}-${Date.now()}`;
    const subscriptionUrl = `sub_${crypto.randomBytes(16).toString('hex')}`;
    const subscriptionResult = queries.insertSubscription.run({
      name: subscriptionName,
      description: `Продажа: ${product.name}`,
      node_ids: JSON.stringify(nodeIds),
      include_mtproto: 1,
      include_socks5: 0,
      subscription_url: subscriptionUrl,
    });
    
    const localSubscriptionId = (subscriptionResult as any).lastInsertRowid;

    // Создаем заказ
    const orderResult = queries.insertOrder.run({
      telegram_id: telegramId,
      product_id: productId,
      status: 'completed',
      payment_method: paymentMethod,
      payment_id: paymentId,
      amount,
      expires_at: expiresAt.toISOString(),
    });
    
    const orderId = (orderResult as any).lastInsertRowid;

    // Выдаем MTProto секреты на нодах
    try {
      const userLinks = await MtprotoUserManager.ensureUserSecretsOnNodes({
        telegramId,
        nodeIds,
        isFakeTls: true,
      });

      const links = userLinks.map(x => x.link);

      // Создаем платеж
      queries.insertPayment.run({
        telegram_id: telegramId,
        order_id: orderId,
        product_id: String(productId),
        amount,
        status: 'completed',
        payment_method: paymentMethod,
        payment_id: paymentId,
      });

      // Создаем подписку пользователя
      queries.insertUserSubscription.run({
        telegram_id: telegramId,
        product_id: productId,
        order_id: orderId,
        local_subscription_id: localSubscriptionId,
        status: 'active',
        expires_at: expiresAt.toISOString(),
      });

      return {
        success: true,
        orderId: orderId,
        links,
      };
    } catch (error: any) {
      // Откатываем изменения при ошибке
      queries.updateOrderStatus.run({
        id: orderId,
        status: 'cancelled',
        expires_at: expiresAt.toISOString(),
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Выбрать ноды для пользователя (балансировка нагрузки)
   */
  private static selectNodesForUser(nodes: any[], count: number): any[] {
    // Сортируем по нагрузке (меньше активных секретов = меньше нагрузка)
    const nodesWithLoad = nodes.map(node => {
      const secrets = queries.getNodeSecrets.all(node.id) as any[];
      return {
        ...node,
        load: secrets.length,
      };
    });

    // Сортируем по нагрузке и берем первые count
    return nodesWithLoad
      .sort((a, b) => a.load - b.load)
      .slice(0, count)
      .map(n => ({ id: n.id, name: n.name, domain: n.domain, mtproto_port: n.mtproto_port }));
  }

  /**
   * Продлить подписку пользователя
   */
  static async extendSubscription(params: {
    telegramId: number;
    subscriptionId: number;
    productId: number;
    paymentMethod: string;
    paymentId: string;
    amount: number;
  }): Promise<OrderResult> {
    const { telegramId, subscriptionId, productId, paymentMethod, paymentId, amount } = params;

    const userSub = queries.getUserSubscriptionById.get(subscriptionId) as any;
    if (!userSub || userSub.telegram_id !== telegramId) {
      return { success: false, error: 'Подписка не найдена' };
    }

    const product = queries.getProductById.get(productId) as any;
    if (!product) {
      return { success: false, error: 'Продукт не найден' };
    }

    // Вычисляем новую дату окончания
    const currentExpires = new Date(userSub.expires_at);
    const baseDate = currentExpires > new Date() ? currentExpires : new Date();
    
    let newExpiresAt: Date;
    if (product.minutes && product.minutes > 0) {
      newExpiresAt = new Date(baseDate.getTime() + product.minutes * 60000);
    } else {
      newExpiresAt = new Date(baseDate.getTime() + product.days * 86400000);
    }

    // Создаем заказ продления
    const orderResult = queries.insertOrder.run({
      telegram_id: telegramId,
      product_id: productId,
      status: 'completed',
      payment_method: paymentMethod,
      payment_id: paymentId,
      amount,
      expires_at: newExpiresAt.toISOString(),
    });
    
    const orderId = (orderResult as any).lastInsertRowid;

    // Обновляем подписку
    queries.updateUserSubscriptionStatus.run({
      id: subscriptionId,
      status: 'active',
    });

    // Обновляем expires_at
    const db = require('./database').default;
    db.prepare(`UPDATE user_subscriptions SET expires_at = ? WHERE id = ?`).run(
      newExpiresAt.toISOString(),
      subscriptionId
    );

    // Создаем платеж
    queries.insertPayment.run({
      telegram_id: telegramId,
      order_id: orderId,
      product_id: String(productId),
      amount,
      status: 'completed',
      payment_method: paymentMethod,
      payment_id: paymentId,
    });

    // Получаем ссылки пользователя
    const secrets = queries.getUserMtprotoSecretsByTelegramId.all(telegramId) as any[];
    const links: string[] = [];
    
    for (const secret of secrets) {
      const node = queries.getNodeById.get(secret.node_id) as any;
      if (node) {
        const { ProxyLinkGenerator } = await import('./node-client');
        links.push(ProxyLinkGenerator.generateMtProtoLink(
          node.domain,
          node.mtproto_port,
          secret.secret,
          secret.is_fake_tls === 1
        ));
      }
    }

    return {
      success: true,
      orderId: orderId,
      links,
    };
  }

  /**
   * Отменить подписку пользователя
   */
  static async cancelSubscription(telegramId: number, subscriptionId: number): Promise<void> {
    const userSub = queries.getUserSubscriptionById.get(subscriptionId) as any;
    if (!userSub || userSub.telegram_id !== telegramId) {
      throw new Error('Подписка не найдена');
    }

    queries.updateUserSubscriptionStatus.run({
      id: subscriptionId,
      status: 'cancelled',
    });

    // Проверяем, есть ли другие активные подписки
    const activeSubs = queries.getActiveUserSubscriptions.all(telegramId) as any[];
    const remnawaveBindings = queries.getRemnawaveBindingsByTelegramId.all(telegramId) as any[];
    const hasRemnawave = remnawaveBindings.some(b => b.status === 'active');

    // Если нет других активных подписок и нет Remnawave - отключаем MTProto
    if (activeSubs.length === 0 && !hasRemnawave) {
      await MtprotoUserManager.disableUser(telegramId);
    }
  }

  /**
   * Получить активные подписки пользователя
   */
  static getUserSubscriptions(telegramId: number): any[] {
    return queries.getActiveUserSubscriptions.all(telegramId) as any[];
  }
}

