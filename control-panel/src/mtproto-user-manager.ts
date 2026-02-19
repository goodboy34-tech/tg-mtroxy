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
}


