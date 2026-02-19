/**
 * Внешнее API для веб-приложения.
 * Используется для авторизации пользователей и выдачи MTProto ссылок.
 */

import http, { IncomingMessage, ServerResponse } from 'http';
import { queries } from './database';
import { getBackendClientFromEnv } from './backend-client';
import { getRemnawaveClientFromEnv } from './remnawave-client';
import { MtprotoUserManager } from './mtproto-user-manager';

const WEB_API_PORT = parseInt(process.env.WEB_API_PORT || '8082', 10);
const WEB_API_KEY = process.env.WEB_API_KEY || '';

if (!WEB_API_KEY) {
  console.warn('⚠️ WEB_API_KEY не задан – Web API будет недоступен до установки ключа.');
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
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-KEY, Authorization',
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
  if (!WEB_API_KEY) {
    json(res, 503, { error: 'Web API key is not configured' });
    return false;
  }
  const headerKey = getHeader(req, 'x-api-key');
  if (!headerKey || headerKey !== WEB_API_KEY) {
    json(res, 401, { error: 'Unauthorized' });
    return false;
  }
  return true;
}

/**
 * Проверить подписку пользователя и выдать MTProto ссылки.
 * 
 * POST /api/web/check-subscription
 * Body: {
 *   telegramId?: number;
 *   username?: string;
 *   shortUuid?: string;
 *   remnawaveSubscriptionId?: string; // Если передана - используем её, иначе ищем активную
 * }
 */
async function handleCheckSubscription(req: IncomingMessage, res: ServerResponse) {
  try {
    const body = await readJsonBody(req) as {
      telegramId?: number;
      username?: string;
      shortUuid?: string;
      remnawaveSubscriptionId?: string;
    };

    // Определяем пользователя
    const backend = getBackendClientFromEnv();
    let backendUser: any;

    if (body.telegramId) {
      backendUser = await backend.getUserByTelegramId(body.telegramId);
    } else if (body.username) {
      backendUser = await backend.getUserByUsername(body.username);
    } else if (body.shortUuid) {
      backendUser = await backend.getUserByShortUuid(body.shortUuid);
    } else {
      return json(res, 400, { error: 'Нужно передать telegramId, username или shortUuid' });
    }

    const userUuid = backendUser.uuid || backendUser.user?.uuid;
    if (!userUuid) {
      return json(res, 404, { error: 'User not found' });
    }

    // Проверяем доступные ноды (активные подписки)
    const acc = await backend.getAccessibleNodes(userUuid);
    const nodes = (acc?.nodes || acc?.data?.nodes || acc?.accessibleNodes || []) as any[];
    const hasAccess = Array.isArray(nodes) && nodes.length > 0;

    if (!hasAccess) {
      return json(res, 200, {
        success: false,
        hasAccess: false,
        message: 'Нет активных подписок',
        links: [],
      });
    }

    // Если передан remnawaveSubscriptionId - используем его
    // Иначе берём первую активную привязку или создаём новую
    let binding: any = null;
    if (body.remnawaveSubscriptionId) {
      binding = queries.getRemnawaveBindingBySubscriptionId.get(body.remnawaveSubscriptionId) as any;
    } else {
      // Ищем активную привязку для этого пользователя
      const bindings = queries.getRemnawaveBindingsByTelegramId.all(body.telegramId || 0) as any[];
      binding = bindings.find(b => b.status === 'active' && b.remnawave_user_id === String(userUuid));
    }

    if (!binding) {
      return json(res, 404, {
        error: 'Подписка не привязана к MTProto. Обратитесь к администратору.',
      });
    }

    const sub = queries.getSubscriptionById.get(binding.local_subscription_id) as any;
    if (!sub) {
      return json(res, 404, { error: 'Local subscription not found' });
    }

    const nodeIds = JSON.parse(sub.node_ids || '[]') as number[];

    // Выдаём персональные секреты если есть telegramId
    if (body.telegramId) {
      const userLinks = await MtprotoUserManager.ensureUserSecretsOnNodes({
        telegramId: body.telegramId,
        nodeIds,
        isFakeTls: true,
      });

      return json(res, 200, {
        success: true,
        hasAccess: true,
        telegramId: body.telegramId,
        remnawaveUserId: userUuid,
        remnawaveSubscriptionId: binding.remnawave_subscription_id,
        links: userLinks.map(x => x.link),
      });
    }

    // Если нет telegramId - возвращаем общие ссылки подписки
    const { SubscriptionManager } = await import('./subscription-manager');
    const proxies = await SubscriptionManager.getSubscriptionProxies(binding.local_subscription_id);
    const links = SubscriptionManager.generateSubscriptionLinks(proxies);

    return json(res, 200, {
      success: true,
      hasAccess: true,
      remnawaveUserId: userUuid,
      remnawaveSubscriptionId: binding.remnawave_subscription_id,
      links,
    });
  } catch (err: any) {
    console.error('[Web API] check-subscription error:', err);
    return json(res, 500, { error: err?.message || 'Internal error' });
  }
}

/**
 * Получить статистику по пользователю.
 * 
 * GET /api/web/user-stats?telegramId=123456789
 */
async function handleUserStats(req: IncomingMessage, res: ServerResponse) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const telegramId = parseInt(url.searchParams.get('telegramId') || '0', 10);

    if (!telegramId) {
      return json(res, 400, { error: 'telegramId required' });
    }

    const secrets = queries.getUserMtprotoSecretsByTelegramId.all(telegramId) as any[];
    const bindings = queries.getRemnawaveBindingsByTelegramId.all(telegramId) as any[];

    return json(res, 200, {
      telegramId,
      secretsCount: secrets.length,
      activeSecrets: secrets.filter(s => s.is_active === 1).length,
      bindingsCount: bindings.length,
      activeBindings: bindings.filter(b => b.status === 'active').length,
    });
  } catch (err: any) {
    console.error('[Web API] user-stats error:', err);
    return json(res, 500, { error: err?.message || 'Internal error' });
  }
}

export function startWebApi() {
  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) return json(res, 400, { error: 'Bad request' });

      // CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-API-KEY, Authorization',
        });
        res.end();
        return;
      }

      if (!assertAuth(req, res)) return;

      const { url, method } = req;

      if (method === 'POST' && url === '/api/web/check-subscription') {
        await handleCheckSubscription(req, res);
        return;
      }

      if (method === 'GET' && url?.startsWith('/api/web/user-stats')) {
        await handleUserStats(req, res);
        return;
      }

      return json(res, 404, { error: 'Not found' });
    } catch (err: any) {
      console.error('[Web API] error:', err);
      return json(res, 500, { error: err?.message || 'Internal error' });
    }
  });

  server.listen(WEB_API_PORT, () => {
    console.log(`🌐 Web API запущен на порту ${WEB_API_PORT}`);
  });
}

