import http, { IncomingMessage, ServerResponse } from 'http';
import { queries } from './database';
import { SubscriptionManager } from './subscription-manager';
import { getBackendClientFromEnv } from './backend-client';
import { MtprotoUserManager } from './mtproto-user-manager';
import { logger } from './logger';

const REMNAWAVE_API_PORT = parseInt(process.env.REMNAWAVE_API_PORT || '8081', 10);
const REMNAWAVE_API_KEY = process.env.REMNAWAVE_API_KEY || '';

if (!REMNAWAVE_API_KEY) {
  logger.warn('⚠️ REMNAWAVE_API_KEY не задан – Remnawave API будет недоступен до установки ключа.');
}

interface RemnawaveSyncBody {
  telegramId?: number;
  remnawaveUserId?: string;
  remnawaveSubscriptionId: string;
  localSubscriptionId: number;
  status: 'active' | 'expired' | 'cancelled';
}

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

function json(res: ServerResponse, status: number, body: any) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function assertAuth(req: IncomingMessage, res: ServerResponse): boolean {
  if (!REMNAWAVE_API_KEY) {
    json(res, 503, { error: 'Remnawave API key is not configured' });
    return false;
  }
  const headerKey = getHeader(req, 'x-api-key');
  if (!headerKey || headerKey !== REMNAWAVE_API_KEY) {
    json(res, 401, { error: 'Unauthorized' });
    return false;
  }
  return true;
}

export function startRemnawaveApi() {
  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) return json(res, 400, { error: 'Bad request' });
      if (!assertAuth(req, res)) return;

      const { url, method } = req;

      if (method === 'POST' && url === '/api/remnawave/authorize') {
        const body = await readJsonBody(req) as {
          telegramId?: number;
          username?: string;
          shortUuid?: string;
          remnawaveSubscriptionId: string;
          localSubscriptionId: number;
        };

        if (!body.remnawaveSubscriptionId || !body.localSubscriptionId) {
          return json(res, 400, { error: 'remnawaveSubscriptionId и localSubscriptionId обязательны' });
        }

        const backend = getBackendClientFromEnv();

        let backendUser: any;
        if (body.telegramId) backendUser = await backend.getUserByTelegramId(body.telegramId);
        else if (body.username) backendUser = await backend.getUserByUsername(body.username);
        else if (body.shortUuid) backendUser = await backend.getUserByShortUuid(body.shortUuid);
        else return json(res, 400, { error: 'Нужно передать telegramId или username или shortUuid' });

        const userUuid = backendUser.uuid || backendUser.user?.uuid;
        if (!userUuid) return json(res, 404, { error: 'User uuid not found in backend response' });

        const acc = await backend.getAccessibleNodes(userUuid);
        const nodes = (acc?.nodes || acc?.data?.nodes || acc?.accessibleNodes || []) as any[];
        const hasAccess = Array.isArray(nodes) && nodes.length > 0;

        queries.upsertRemnawaveBinding.run({
          telegram_id: body.telegramId ?? null,
          remnawave_user_id: String(userUuid),
          remnawave_subscription_id: body.remnawaveSubscriptionId,
          local_subscription_id: body.localSubscriptionId,
          status: hasAccess ? 'active' : 'expired',
        });

        if (!hasAccess) {
          if (body.telegramId) await MtprotoUserManager.disableUser(body.telegramId);
          return json(res, 200, { success: true, status: 'expired', links: [] });
        }

        const sub = queries.getSubscriptionById.get(body.localSubscriptionId) as any;
        if (!sub) return json(res, 404, { error: 'Local subscription not found' });
        const nodeIds = JSON.parse(sub.node_ids) as number[];

        if (!body.telegramId) {
          return json(res, 400, { error: 'telegramId обязателен для выдачи персонального MTProto (точечного отключения)' });
        }

        // Проверяем, есть ли купленные подписки
        const { SalesManager } = await import('./sales-manager');
        const userSubs = SalesManager.getUserSubscriptions(body.telegramId);
        
        // Если есть купленные подписки - Remnawave не нужен (приоритет продажам)
        if (userSubs.length > 0) {
          return json(res, 200, {
            success: true,
            status: 'active',
            message: 'User has purchased subscription, Remnawave access not needed',
            telegramId: body.telegramId,
            backendUserUuid: userUuid,
            remnawaveSubscriptionId: body.remnawaveSubscriptionId,
            localSubscriptionId: body.localSubscriptionId,
            links: [],
          });
        }

        const userLinks = await MtprotoUserManager.ensureUserSecretsOnNodes({
          telegramId: body.telegramId,
          nodeIds,
          isFakeTls: true,
        });

        queries.updateSubscriptionAccess.run(body.localSubscriptionId);

        return json(res, 200, {
          success: true,
          status: 'active',
          telegramId: body.telegramId,
          backendUserUuid: userUuid,
          remnawaveSubscriptionId: body.remnawaveSubscriptionId,
          localSubscriptionId: body.localSubscriptionId,
          links: userLinks.map(x => x.link),
        });
      }

      if (method === 'POST' && url === '/api/remnawave/users/sync') {
        const body = await readJsonBody(req) as RemnawaveSyncBody;
        if (!body.remnawaveSubscriptionId || !body.localSubscriptionId || !body.status) {
          return json(res, 400, { error: 'remnawaveSubscriptionId, localSubscriptionId и status обязательны' });
        }
        if (body.status !== 'active') {
          queries.updateRemnawaveStatus.run({
            status: body.status,
            remnawave_subscription_id: body.remnawaveSubscriptionId,
          });
          return json(res, 200, { success: true, status: body.status, links: [] });
        }

        const tgId = body.telegramId ?? null;
        queries.upsertRemnawaveBinding.run({
          telegram_id: tgId,
          remnawave_user_id: body.remnawaveUserId ?? null,
          remnawave_subscription_id: body.remnawaveSubscriptionId,
          local_subscription_id: body.localSubscriptionId,
          status: 'active',
        });

        const proxies = await SubscriptionManager.getSubscriptionProxies(body.localSubscriptionId);
        const links = SubscriptionManager.generateSubscriptionLinks(proxies);
        queries.updateSubscriptionAccess.run(body.localSubscriptionId);
        return json(res, 200, { success: true, status: 'active', telegramId: tgId, remnawaveSubscriptionId: body.remnawaveSubscriptionId, localSubscriptionId: body.localSubscriptionId, links });
      }

      if (method === 'POST' && url === '/api/remnawave/users/by-link') {
        const body = await readJsonBody(req) as {
          remnawaveSubscriptionLink: string;
          localSubscriptionId: number;
          status: 'active' | 'expired' | 'cancelled';
          telegramId?: number;
          remnawaveUserId?: string;
        };
        if (!body.remnawaveSubscriptionLink || !body.localSubscriptionId || !body.status) {
          return json(res, 400, { error: 'remnawaveSubscriptionLink, localSubscriptionId и status обязательны' });
        }
        const remnaId = body.remnawaveSubscriptionLink;
        if (body.status !== 'active') {
          queries.updateRemnawaveStatus.run({
            status: body.status,
            remnawave_subscription_id: remnaId,
          });
          return json(res, 200, { success: true, status: body.status, links: [] });
        }

        const tgId = body.telegramId ?? null;
        queries.upsertRemnawaveBinding.run({
          telegram_id: tgId,
          remnawave_user_id: body.remnawaveUserId ?? null,
          remnawave_subscription_id: remnaId,
          local_subscription_id: body.localSubscriptionId,
          status: 'active',
        });

        const proxies = await SubscriptionManager.getSubscriptionProxies(body.localSubscriptionId);
        const links = SubscriptionManager.generateSubscriptionLinks(proxies);
        queries.updateSubscriptionAccess.run(body.localSubscriptionId);

        return json(res, 200, { success: true, status: 'active', telegramId: tgId, remnawaveSubscriptionId: remnaId, localSubscriptionId: body.localSubscriptionId, links });
      }

      if (method === 'POST' && url === '/api/remnawave/subscriptions/status') {
        const items = await readJsonBody(req) as Array<{ remnawaveSubscriptionId: string; status: 'active' | 'expired' | 'cancelled' }>;
        if (!Array.isArray(items) || items.length === 0) {
          return json(res, 400, { error: 'Body must be a non-empty array' });
        }
        for (const item of items) {
          if (!item?.remnawaveSubscriptionId || !item?.status) continue;
          queries.updateRemnawaveStatus.run({
            status: item.status,
            remnawave_subscription_id: item.remnawaveSubscriptionId,
          });
        }
        return json(res, 200, { success: true, updated: items.length });
      }

      return json(res, 404, { error: 'Not found' });
    } catch (err: any) {
      logger.error('[Remnawave API] error:', err);
      return json(res, 500, { error: err?.message || 'Internal error' });
    }
  });

  server.listen(REMNAWAVE_API_PORT, () => {
    logger.info(`🌐 Remnawave API запущен на порту ${REMNAWAVE_API_PORT}`);
  });
}


