import { queries } from './database';
import { NodeApiClient, ProxyLinkGenerator, SecretGenerator } from './node-client';

/**
 * Менеджер персональных MTProto-секретов пользователя.
 *
 * Идея: каждому telegram_id выдаём уникальные секреты на каждой ноде из подписки.
 * Тогда при истечении подписки можно точечно удалить секреты и реально отобрать доступ.
 */
export class MtprotoUserManager {
  static getNodeClient(nodeId: number): NodeApiClient | null {
    const node = queries.getNodeById.get(nodeId) as any;
    if (!node) return null;
    return new NodeApiClient({
      id: node.id,
      name: node.name,
      apiUrl: node.api_url,
      apiToken: node.api_token,
    });
  }

  static async ensureUserSecretsOnNodes(params: {
    telegramId: number;
    nodeIds: number[];
    isFakeTls?: boolean;
  }): Promise<Array<{ nodeId: number; link: string; secret: string }>> {
    const isFakeTls = params.isFakeTls ?? true;
    const results: Array<{ nodeId: number; link: string; secret: string }> = [];

    for (const nodeId of params.nodeIds) {
      const node = queries.getNodeById.get(nodeId) as any;
      if (!node || node.status !== 'online') continue;

      const existing = queries.getUserMtprotoSecretForNode.get(params.telegramId, nodeId) as any;
      let secret = existing?.secret as string | undefined;
      let active = existing?.is_active === 1;

      if (!secret || !active) {
        secret = SecretGenerator.generateMtProtoSecret();
        queries.upsertUserMtprotoSecret.run({
          telegram_id: params.telegramId,
          node_id: nodeId,
          secret,
          is_fake_tls: isFakeTls ? 1 : 0,
          is_active: 1,
        });

        const client = this.getNodeClient(nodeId);
        if (client) {
          await client.addMtProtoSecret({ secret, isFakeTls, description: `tg:${params.telegramId}` });
        }
      }

      const link = ProxyLinkGenerator.generateMtProtoLink(node.domain, node.mtproto_port, secret, isFakeTls);
      results.push({ nodeId, link, secret });
    }

    return results;
  }

  static async disableUser(telegramId: number): Promise<void> {
    const secrets = queries.getUserMtprotoSecretsByTelegramId.all(telegramId) as any[];
    for (const row of secrets) {
      const nodeId = row.node_id as number;
      const secret = row.secret as string;
      const client = this.getNodeClient(nodeId);
      if (client) {
        // remove on node (will restart MTProto there)
        await client.removeMtProtoSecret(secret);
      }
    }
    queries.deactivateUserMtprotoSecrets.run(telegramId);
  }

  /**
   * Полностью удалить все MTProto секреты пользователя (из БД и с нод).
   * Используется при истечении подписки, чтобы пользователь мог получить новый MTProto при продлении.
   * 
   * Важно: секреты хранятся в БД БЕЗ префикса "dd" (чистый секрет),
   * node-agent также хранит секреты БЕЗ префикса, но с флагом isFakeTls.
   * При удалении передаем чистый секрет (без "dd").
   */
  static async deleteUserCompletely(telegramId: number): Promise<void> {
    // Получаем все секреты (включая неактивные)
    const allSecrets = queries.getAllUserMtprotoSecretsAll.all() as any[];
    const userSecrets = allSecrets.filter(s => s.telegram_id === telegramId);

    const { logger } = await import('./logger');
    let deletedFromNodes = 0;
    let failedNodes: number[] = [];

    for (const row of userSecrets) {
      const nodeId = row.node_id as number;
      const secret = row.secret as string; // Чистый секрет без префикса "dd"
      const isFakeTls = row.is_fake_tls === 1;
      
      const client = this.getNodeClient(nodeId);
      if (client) {
        try {
          // Удаляем секрет с ноды (передаем чистый секрет, node-agent сам знает какой это секрет)
          // node-agent хранит секреты БЕЗ префикса "dd", поэтому передаем чистый секрет
          await client.removeMtProtoSecret(secret);
          deletedFromNodes++;
          logger.debug(`[deleteUserCompletely] Удален секрет с ноды ${nodeId} для пользователя ${telegramId} (fakeTLS: ${isFakeTls})`);
        } catch (e: any) {
          // Логируем ошибки, но продолжаем удаление
          failedNodes.push(nodeId);
          logger.warn(`[deleteUserCompletely] Не удалось удалить секрет с ноды ${nodeId} для пользователя ${telegramId}: ${e.message}`);
        }
      } else {
        logger.warn(`[deleteUserCompletely] Не удалось получить клиент для ноды ${nodeId}`);
        failedNodes.push(nodeId);
      }
    }

    // Удаляем все секреты из БД (даже если не удалось удалить с некоторых нод)
    queries.deleteUserMtprotoSecrets.run(telegramId);
    
    if (deletedFromNodes > 0) {
      logger.info(`[deleteUserCompletely] Удалено ${deletedFromNodes} секретов с нод для пользователя ${telegramId}`);
    }
    
    if (failedNodes.length > 0) {
      logger.warn(`[deleteUserCompletely] Не удалось удалить секреты с нод: ${failedNodes.join(', ')} для пользователя ${telegramId}`);
    }
  }
}


