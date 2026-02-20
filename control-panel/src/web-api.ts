/**
 * Внешнее API для веб-приложения.
 * Используется для авторизации пользователей и выдачи MTProto ссылок.
 */

import http, { IncomingMessage, ServerResponse } from 'http';
import { queries } from './database';
import { getBackendClientFromEnv } from './backend-client';
import { getRemnawaveClientFromEnv } from './remnawave-client';
import { MtprotoUserManager } from './mtproto-user-manager';
import { logger } from './logger';

const WEB_API_PORT = parseInt(process.env.WEB_API_PORT || '8082', 10);
const WEB_API_KEY = process.env.WEB_API_KEY || '';

if (!WEB_API_KEY) {
  logger.warn('⚠️ WEB_API_KEY не задан – Web API будет недоступен до установки ключа.');
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
    if (!backend) {
      return json(res, 503, { error: 'Backend не настроен. Укажите BACKEND_BASE_URL и BACKEND_TOKEN в .env' });
    }
    
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
    logger.error('[Web API] check-subscription error:', err);
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
    logger.error('[Web API] user-stats error:', err);
    return json(res, 500, { error: err?.message || 'Internal error' });
  }
}

/**
 * Активировать MTProto по ссылке Remnawave подписки.
 * 
 * POST /api/web/activate-by-link
 * Body: {
 *   subscriptionLink: string; // Ссылка на подписку Remnawave
 *   telegramId?: number; // Опционально, если нужно создать персональные секреты
 * }
 */
async function handleActivateByLink(req: IncomingMessage, res: ServerResponse) {
  try {
    const body = await readJsonBody(req) as {
      subscriptionLink: string;
      telegramId?: number;
    };

    if (!body.subscriptionLink) {
      return json(res, 400, { error: 'subscriptionLink required' });
    }

    const remnawave = getRemnawaveClientFromEnv();
    if (!remnawave) {
      return json(res, 503, { error: 'Remnawave API не настроен. Укажите REMNAWAVE_BASE_URL и REMNAWAVE_TOKEN в .env' });
    }

    // Получаем информацию о подписке из Remnawave
    logger.info(`[Web API] activate-by-link: получение информации о подписке ${body.subscriptionLink}`);
    const subInfo = await remnawave.getSubscriptionInfo(body.subscriptionLink);
    if (!subInfo) {
      logger.warn(`[Web API] activate-by-link: подписка не найдена ${body.subscriptionLink}`);
      return json(res, 404, { error: 'Подписка не найдена в Remnawave' });
    }
    logger.info(`[Web API] activate-by-link: найдена подписка для пользователя ${subInfo.userUuid}`);

    // Проверяем, есть ли активные подписки у пользователя
    const nodes = await remnawave.getAccessibleNodes(subInfo.userUuid);
    if (nodes.length === 0) {
      return json(res, 200, {
        success: false,
        hasAccess: false,
        message: 'Подписка неактивна или истекла',
        links: [],
      });
    }

    // Получаем все активные ноды из нашей БД
    const activeNodes = queries.getActiveNodes.all() as any[];
    if (activeNodes.length === 0) {
      return json(res, 503, { error: 'Нет доступных нод в системе' });
    }

    // Если передан telegramId - проверяем правило "1 Telegram ID = 1 MTProxy подписка"
    const telegramId = body.telegramId || subInfo.telegramId;
    if (!telegramId) {
      // Если нет telegramId - возвращаем общие ссылки подписки
      const existingBinding = queries.getRemnawaveBindingBySubscriptionId.get(subInfo.subscriptionId) as any;
      let localSubId: number;
      if (existingBinding) {
        localSubId = existingBinding.local_subscription_id;
      } else {
        const { SubscriptionManager } = await import('./subscription-manager');
        const nodeIds = activeNodes.map(n => n.id);
        localSubId = await SubscriptionManager.createSubscription(
          `Remnawave: ${subInfo.subscriptionId}`,
          `Подписка из Remnawave для пользователя ${subInfo.userUuid}`,
          nodeIds,
          true, // includeMtproto
          false // includeSocks5
        );
        queries.upsertRemnawaveBinding.run({
          telegram_id: null,
          remnawave_user_id: subInfo.userUuid,
          remnawave_subscription_id: subInfo.subscriptionId,
          local_subscription_id: localSubId,
          status: 'active',
        });
      }
      const { SubscriptionManager } = await import('./subscription-manager');
      const proxies = await SubscriptionManager.getSubscriptionProxies(localSubId);
      const links = SubscriptionManager.generateSubscriptionLinks(proxies);
      return json(res, 200, {
        success: true,
        hasAccess: true,
        remnawaveUserId: subInfo.userUuid,
        remnawaveSubscriptionId: subInfo.subscriptionId,
        expireAt: subInfo.expireAt,
        links,
      });
    }

    // Проверяем правило "1 Telegram ID = 1 MTProxy подписка"
    const existingSubs = queries.getActiveUserSubscriptions.all(telegramId) as any[];
    const existingBindings = queries.getRemnawaveBindingsByTelegramId.all(telegramId) as any[];
    const hasActiveSub = existingSubs.length > 0 || existingBindings.some(b => b.status === 'active');

    let localSubId: number;
    const existingBinding = queries.getRemnawaveBindingBySubscriptionId.get(subInfo.subscriptionId) as any;
    
    if (existingBinding) {
      localSubId = existingBinding.local_subscription_id;
    } else if (hasActiveSub) {
      // Если уже есть активная подписка - используем её
      if (existingSubs.length > 0) {
        localSubId = existingSubs[0].local_subscription_id;
      } else if (existingBindings.length > 0) {
        const activeBinding = existingBindings.find(b => b.status === 'active');
        localSubId = activeBinding?.local_subscription_id || existingSubs[0]?.local_subscription_id;
      } else {
        // Fallback: создаём новую подписку
        const { SubscriptionManager } = await import('./subscription-manager');
        const nodeIds = activeNodes.map(n => n.id);
        localSubId = await SubscriptionManager.createSubscription(
          `Remnawave: ${subInfo.subscriptionId}`,
          `Подписка из Remnawave для пользователя ${subInfo.userUuid}`,
          nodeIds,
          true, // includeMtproto
          false // includeSocks5
        );
      }

      // Создаём привязку для новой Remnawave подписки к существующей локальной подписке
      queries.upsertRemnawaveBinding.run({
        telegram_id: telegramId,
        remnawave_user_id: subInfo.userUuid,
        remnawave_subscription_id: subInfo.subscriptionId,
        local_subscription_id: localSubId,
        status: 'active',
      });
    } else {
      // Создаём новую подписку
      const { SubscriptionManager } = await import('./subscription-manager');
      const nodeIds = activeNodes.map(n => n.id);
      localSubId = await SubscriptionManager.createSubscription(
        `Remnawave: ${subInfo.subscriptionId}`,
        `Подписка из Remnawave для пользователя ${subInfo.userUuid}`,
        nodeIds,
        true, // includeMtproto
        false // includeSocks5
      );

      queries.upsertRemnawaveBinding.run({
        telegram_id: telegramId,
        remnawave_user_id: subInfo.userUuid,
        remnawave_subscription_id: subInfo.subscriptionId,
        local_subscription_id: localSubId,
        status: 'active',
      });
    }

    const nodeIds = activeNodes.map(n => n.id);
    const userLinks = await MtprotoUserManager.ensureUserSecretsOnNodes({
      telegramId,
      nodeIds,
      isFakeTls: true,
    });

    // Создаем user_subscription с правильной датой окончания (или бесконечную подписку)
    const products = queries.getAllProducts.all() as any[];
    const productId = products.length > 0 ? products[0].id : 0;
    const currentSubs = queries.getActiveUserSubscriptions.all(telegramId) as any[];
    const hasRemnawaveSub = currentSubs.some(s => s.local_subscription_id === localSubId);

    if (!hasRemnawaveSub) {
      // Если expireAt = null - создаём бесконечную подписку
      queries.insertUserSubscription.run({
        telegram_id: telegramId,
        product_id: productId,
        order_id: null,
        local_subscription_id: localSubId,
        status: 'active',
        expires_at: subInfo.expireAt || null, // null = бесконечная подписка
      });
    } else if (subInfo.expireAt) {
      // Обновляем дату окончания существующей подписки, если новая дата позже
      const existingSub = currentSubs.find(s => s.local_subscription_id === localSubId);
      if (existingSub) {
        const existingExpiresAt = existingSub.expires_at ? new Date(existingSub.expires_at) : null;
        const newExpiresAt = new Date(subInfo.expireAt);
        if (!existingExpiresAt || newExpiresAt > existingExpiresAt) {
          queries.updateUserSubscriptionExpiresAt.run({
            id: existingSub.id,
            expires_at: subInfo.expireAt,
          });
        }
      }
    }

      return json(res, 200, {
        success: true,
        hasAccess: true,
        telegramId: body.telegramId,
        remnawaveUserId: subInfo.userUuid,
        remnawaveSubscriptionId: subInfo.subscriptionId,
        expireAt: subInfo.expireAt,
        links: userLinks.map(x => x.link),
      });
    }

    // Если нет telegramId - возвращаем общие ссылки подписки
    const { SubscriptionManager } = await import('./subscription-manager');
    const proxies = await SubscriptionManager.getSubscriptionProxies(localSubId);
    const links = SubscriptionManager.generateSubscriptionLinks(proxies);

    return json(res, 200, {
      success: true,
      hasAccess: true,
      remnawaveUserId: subInfo.userUuid,
      remnawaveSubscriptionId: subInfo.subscriptionId,
      expireAt: subInfo.expireAt,
      links,
    });
  } catch (err: any) {
    logger.error('[Web API] activate-by-link error:', err);
    return json(res, 500, { error: err?.message || 'Internal error' });
  }
}

/**
 * Активировать MTProto по username пользователя Remnawave.
 * 
 * POST /api/web/activate-by-username
 * Body: {
 *   username: string; // Username пользователя в Remnawave
 *   telegramId?: number; // Опционально, если нужно создать персональные секреты
 * }
 */
async function handleActivateByUsername(req: IncomingMessage, res: ServerResponse) {
  try {
    const body = await readJsonBody(req) as {
      username: string;
      telegramId?: number;
    };

    if (!body.username) {
      return json(res, 400, { error: 'username required' });
    }

    const remnawave = getRemnawaveClientFromEnv();
    if (!remnawave) {
      return json(res, 503, { error: 'Remnawave API не настроен. Укажите REMNAWAVE_BASE_URL и REMNAWAVE_TOKEN в .env' });
    }

    // Находим пользователя в Remnawave
    logger.info(`[Web API] activate-by-username: поиск пользователя ${body.username}`);
    const user = await remnawave.getUserByUsername(body.username.replace('@', ''));
    if (!user) {
      logger.warn(`[Web API] activate-by-username: пользователь не найден ${body.username}`);
      return json(res, 404, { error: 'Пользователь не найден в Remnawave' });
    }
    logger.info(`[Web API] activate-by-username: найден пользователь ${user.uuid}`);

    // Проверяем активные подписки
    const nodes = await remnawave.getAccessibleNodes(user.uuid);
    if (nodes.length === 0) {
      return json(res, 200, {
        success: false,
        hasAccess: false,
        message: 'У пользователя нет активных подписок',
        links: [],
      });
    }

    // Получаем все активные ноды из нашей БД
    const activeNodes = queries.getActiveNodes.all() as any[];
    if (activeNodes.length === 0) {
      return json(res, 503, { error: 'Нет доступных нод в системе' });
    }

    // Если передан telegramId - проверяем правило "1 Telegram ID = 1 MTProxy подписка"
    const telegramId = body.telegramId || user.telegramId;
    if (!telegramId) {
      // Если нет telegramId - возвращаем общие ссылки подписки
      const existingBindings = queries.getRemnawaveBindingsByUserId.all(user.uuid) as any[];
      const activeBinding = existingBindings.find(b => b.status === 'active');
      let localSubId: number;
      let remnawaveSubscriptionId = `user_${user.uuid}`;

      if (activeBinding) {
        localSubId = activeBinding.local_subscription_id;
        remnawaveSubscriptionId = activeBinding.remnawave_subscription_id;
      } else {
        const { SubscriptionManager } = await import('./subscription-manager');
        const nodeIds = activeNodes.map(n => n.id);
        localSubId = await SubscriptionManager.createSubscription(
          `Remnawave: ${user.username || user.uuid}`,
          `Подписка из Remnawave для пользователя ${user.uuid}`,
          nodeIds,
          true, // includeMtproto
          false // includeSocks5
        );
        queries.upsertRemnawaveBinding.run({
          telegram_id: null,
          remnawave_user_id: user.uuid,
          remnawave_subscription_id: remnawaveSubscriptionId,
          local_subscription_id: localSubId,
          status: 'active',
        });
      }
      const { SubscriptionManager } = await import('./subscription-manager');
      const proxies = await SubscriptionManager.getSubscriptionProxies(localSubId);
      const links = SubscriptionManager.generateSubscriptionLinks(proxies);
      return json(res, 200, {
        success: true,
        hasAccess: true,
        remnawaveUserId: user.uuid,
        remnawaveSubscriptionId,
        expireAt: user.expireAt,
        links,
      });
    }

    // Проверяем правило "1 Telegram ID = 1 MTProxy подписка"
    const existingSubs = queries.getActiveUserSubscriptions.all(telegramId) as any[];
    const existingBindings = queries.getRemnawaveBindingsByTelegramId.all(telegramId) as any[];
    const hasActiveSub = existingSubs.length > 0 || existingBindings.some(b => b.status === 'active');

    let localSubId: number;
    let remnawaveSubscriptionId = `user_${user.uuid}`;

    if (hasActiveSub) {
      // Если уже есть активная подписка - используем её
      if (existingSubs.length > 0) {
        localSubId = existingSubs[0].local_subscription_id;
      } else if (existingBindings.length > 0) {
        const activeBinding = existingBindings.find(b => b.status === 'active');
        localSubId = activeBinding?.local_subscription_id || existingSubs[0]?.local_subscription_id;
        remnawaveSubscriptionId = activeBinding?.remnawave_subscription_id || remnawaveSubscriptionId;
      } else {
        // Fallback: создаём новую подписку
        const { SubscriptionManager } = await import('./subscription-manager');
        const nodeIds = activeNodes.map(n => n.id);
        localSubId = await SubscriptionManager.createSubscription(
          `Remnawave: ${user.username || user.uuid}`,
          `Подписка из Remnawave для пользователя ${user.uuid}`,
          nodeIds,
          true, // includeMtproto
          false // includeSocks5
        );
      }

      // Создаём привязку для новой Remnawave подписки к существующей локальной подписке
      queries.upsertRemnawaveBinding.run({
        telegram_id: telegramId,
        remnawave_user_id: user.uuid,
        remnawave_subscription_id: remnawaveSubscriptionId,
        local_subscription_id: localSubId,
        status: 'active',
      });
    } else {
      // Создаём новую подписку
      const { SubscriptionManager } = await import('./subscription-manager');
      const nodeIds = activeNodes.map(n => n.id);
      localSubId = await SubscriptionManager.createSubscription(
        `Remnawave: ${user.username || user.uuid}`,
        `Подписка из Remnawave для пользователя ${user.uuid}`,
        nodeIds,
        true, // includeMtproto
        false // includeSocks5
      );

      queries.upsertRemnawaveBinding.run({
        telegram_id: telegramId,
        remnawave_user_id: user.uuid,
        remnawave_subscription_id: remnawaveSubscriptionId,
        local_subscription_id: localSubId,
        status: 'active',
      });
    }

    const nodeIds = activeNodes.map(n => n.id);
    const userLinks = await MtprotoUserManager.ensureUserSecretsOnNodes({
      telegramId,
      nodeIds,
      isFakeTls: true,
    });

    // Создаем user_subscription с правильной датой окончания (или бесконечную подписку)
    const products = queries.getAllProducts.all() as any[];
    const productId = products.length > 0 ? products[0].id : 0;
    const currentSubs = queries.getActiveUserSubscriptions.all(telegramId) as any[];
    const hasRemnawaveSub = currentSubs.some(s => s.local_subscription_id === localSubId);

    if (!hasRemnawaveSub) {
      // Если expireAt = null - создаём бесконечную подписку
      queries.insertUserSubscription.run({
        telegram_id: telegramId,
        product_id: productId,
        order_id: null,
        local_subscription_id: localSubId,
        status: 'active',
        expires_at: user.expireAt || null, // null = бесконечная подписка
      });
    } else if (user.expireAt) {
      // Обновляем дату окончания существующей подписки, если новая дата позже
      const existingSub = currentSubs.find(s => s.local_subscription_id === localSubId);
      if (existingSub) {
        const existingExpiresAt = existingSub.expires_at ? new Date(existingSub.expires_at) : null;
        const newExpiresAt = new Date(user.expireAt);
        if (!existingExpiresAt || newExpiresAt > existingExpiresAt) {
          queries.updateUserSubscriptionExpiresAt.run({
            id: existingSub.id,
            expires_at: user.expireAt,
          });
        }
      }
    }

      return json(res, 200, {
        success: true,
        hasAccess: true,
        telegramId,
        remnawaveUserId: user.uuid,
        remnawaveSubscriptionId,
        expireAt: user.expireAt,
        links: userLinks.map(x => x.link),
      });
    }

    // Если нет telegramId - возвращаем общие ссылки подписки
    const { SubscriptionManager } = await import('./subscription-manager');
    const proxies = await SubscriptionManager.getSubscriptionProxies(localSubId);
    const links = SubscriptionManager.generateSubscriptionLinks(proxies);

    return json(res, 200, {
      success: true,
      hasAccess: true,
      remnawaveUserId: user.uuid,
      remnawaveSubscriptionId,
      expireAt: user.expireAt,
      links,
    });
  } catch (err: any) {
    logger.error('[Web API] activate-by-username error:', err);
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

      if (method === 'POST' && url === '/api/web/activate-by-link') {
        await handleActivateByLink(req, res);
        return;
      }

      if (method === 'POST' && url === '/api/web/activate-by-username') {
        await handleActivateByUsername(req, res);
        return;
      }

      return json(res, 404, { error: 'Not found' });
    } catch (err: any) {
      logger.error('[Web API] error:', err);
      return json(res, 500, { error: err?.message || 'Internal error' });
    }
  });

  server.listen(WEB_API_PORT, () => {
    logger.info(`🌐 Web API запущен на порту ${WEB_API_PORT}`);
  });
}

