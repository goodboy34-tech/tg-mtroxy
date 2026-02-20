import http, { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import { queries } from './database';
import { SubscriptionManager } from './subscription-manager';
import { getBackendClientFromEnv } from './backend-client';
import { MtprotoUserManager } from './mtproto-user-manager';
import { logger } from './logger';

const REMNAWAVE_API_PORT = parseInt(process.env.REMNAWAVE_API_PORT || '8081', 10);
// REMNAWAVE_API_KEY используется для проверки заголовка x-api-key
// WEBHOOK_SECRET_HEADER используется для проверки кастомного заголовка от Remnawave
const REMNAWAVE_API_KEY = process.env.REMNAWAVE_API_KEY || '';
const WEBHOOK_SECRET_HEADER = process.env.WEBHOOK_SECRET_HEADER || '';

if (!REMNAWAVE_API_KEY && !WEBHOOK_SECRET_HEADER) {
  logger.warn('⚠️ REMNAWAVE_API_KEY или WEBHOOK_SECRET_HEADER не заданы – Remnawave API будет недоступен до установки ключа.');
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

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(String(c)));
  return Buffer.concat(chunks);
}

async function readJsonBody(req: IncomingMessage): Promise<any> {
  const raw = (await readBody(req)).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

/**
 * Проверка HMAC подписи для Remnawave webhook
 * Согласно документации: https://docs.rw/docs/features/webhooks/#verify-webhook
 * Подпись создается как: HMAC-SHA256(JSON.stringify(body), secret)
 * 
 * Важно: используем raw body (как приходит), а не распарсенный объект,
 * чтобы избежать проблем с порядком ключей и форматированием JSON
 */
function verifyWebhookSignature(
  signature: string,
  body: Buffer | string,
  secret: string
): boolean {
  try {
    // Преобразуем тело в строку (используем raw body, как приходит)
    const bodyStr = typeof body === 'string' ? body : body.toString('utf8');
    
    // Создаем HMAC подпись из raw body
    // Согласно документации: createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex')
    // Но так как body уже строка JSON, используем его напрямую
    const expectedSignature = crypto.createHmac('sha256', secret)
      .update(bodyStr)
      .digest('hex');
    
    // Сравниваем подписи безопасным способом (constant-time comparison)
    // Согласно документации, подпись создается как hex строка (digest('hex'))
    if (signature.length !== expectedSignature.length) {
      return false;
    }
    
    // Используем timing-safe comparison для безопасности
    // Обе подписи в hex формате, преобразуем в Buffer для сравнения
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch (e: any) {
      // Если не удалось преобразовать в hex - сравниваем как строки (fallback)
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'utf8'),
        Buffer.from(expectedSignature, 'utf8')
      );
    }
  } catch (e: any) {
    logger.error('[verifyWebhookSignature] Error:', e);
    return false;
  }
}

async function assertAuth(req: IncomingMessage, res: ServerResponse, body?: Buffer): Promise<boolean> {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'remnawave-api.ts:49',message:'assertAuth called',data:{url:req.url,method:req.method,hasRemnawaveApiKey:!!REMNAWAVE_API_KEY,hasWebhookSecretHeader:!!WEBHOOK_SECRET_HEADER,allHeaderNames:Object.keys(req.headers)},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
  // #endregion
  // Проверяем либо x-api-key (REMNAWAVE_API_KEY), либо подпись webhook (X-Remnawave-Signature)
  if (REMNAWAVE_API_KEY && REMNAWAVE_API_KEY !== 'change-me') {
    const headerKey = getHeader(req, 'x-api-key');
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'remnawave-api.ts:53',message:'Checking x-api-key',data:{hasHeaderKey:!!headerKey,matches:headerKey === REMNAWAVE_API_KEY},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    if (headerKey && headerKey === REMNAWAVE_API_KEY) {
      return true;
    }
  }
  
  // Remnawave использует подпись webhook'ов через X-Remnawave-Signature и X-Remnawave-Timestamp
  // Проверяем подпись, если есть WEBHOOK_SECRET_HEADER
  if (WEBHOOK_SECRET_HEADER) {
    const signature = getHeader(req, 'x-remnawave-signature');
    const timestamp = getHeader(req, 'x-remnawave-timestamp');
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'remnawave-api.ts:62',message:'Checking webhook signature',data:{hasSignature:!!signature,hasTimestamp:!!timestamp,hasBody:!!body},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    
    // Если есть подпись - проверяем HMAC подпись (только по телу, без timestamp)
    if (signature && body) {
      const isValid = verifyWebhookSignature(signature, body, WEBHOOK_SECRET_HEADER);
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'remnawave-api.ts:75',message:'HMAC signature verification result',data:{isValid,hasSignature:!!signature,hasBody:!!body},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      if (isValid) {
        return true;
      }
    }
    
    // Также проверяем простой секрет в заголовке (для обратной совместимости)
    const possibleHeaderNames = [
      'x-webhook-secret-header',
      'webhook-secret-header', 
      'x-webhook-secret',
      'webhook-secret',
      'x-remnawave-secret',
      'remnawave-secret',
      'x-secret-header',
      'secret-header',
      'authorization', // Стандартный заголовок авторизации
      'x-authorization',
    ];
    
    for (const headerName of possibleHeaderNames) {
      const value = getHeader(req, headerName);
      // #region agent log
      if (value) fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'remnawave-api.ts:89',message:'Checking secret header',data:{headerName,hasValue:!!value,matches:value === WEBHOOK_SECRET_HEADER},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      if (value) {
        // Проверяем прямое совпадение
        if (value === WEBHOOK_SECRET_HEADER) {
          return true;
        }
        // Проверяем формат "Bearer <token>"
        if (value.startsWith('Bearer ')) {
          const token = value.substring(7);
          if (token === WEBHOOK_SECRET_HEADER) {
            return true;
          }
        }
        // Проверяем формат "Basic <token>" или другие форматы
        if (value.includes(' ')) {
          const parts = value.split(' ');
          if (parts.length > 1 && parts[parts.length - 1] === WEBHOOK_SECRET_HEADER) {
            return true;
          }
        }
      }
    }
    
    // Логируем для отладки (только если не прошла авторизация)
    if (req.url?.includes('/api/remnawave')) {
      const allHeaders = req.headers;
      // Собираем все заголовки с их значениями (первые 50 символов для безопасности)
      const headerValues: Record<string, string> = {};
      for (const [key, value] of Object.entries(allHeaders)) {
        const val = Array.isArray(value) ? value[0] : value;
        headerValues[key] = typeof val === 'string' ? val.substring(0, 50) : String(val).substring(0, 50);
      }
      
      logger.warn('[Remnawave API] Auth failed. Webhook authentication failed.', {
        url: req.url,
        method: req.method,
        hasSignature: !!signature,
        hasTimestamp: !!timestamp,
        allHeaderNames: Object.keys(allHeaders),
        headerValues: headerValues,
        expectedSecretHeader: WEBHOOK_SECRET_HEADER ? WEBHOOK_SECRET_HEADER.substring(0, 20) + '...' : 'not set',
        userAgent: getHeader(req, 'user-agent'),
      });
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'remnawave-api.ts:107',message:'Auth failed - logging details',data:{url:req.url,allHeaderNames:Object.keys(allHeaders),headerValues:headerValues,hasSignature:!!signature,hasTimestamp:!!timestamp,expectedSecretHeader:WEBHOOK_SECRET_HEADER ? WEBHOOK_SECRET_HEADER.substring(0,20) + '...' : 'not set'},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
      // #endregion
    }
  }
  
  if (!REMNAWAVE_API_KEY && !WEBHOOK_SECRET_HEADER) {
    json(res, 503, { error: 'Remnawave API key is not configured' });
    return false;
  }
  
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'remnawave-api.ts:115',message:'Auth failed - returning 401',data:{url:req.url},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
  // #endregion
  json(res, 401, { error: 'Unauthorized' });
  return false;
}

export function startRemnawaveApi() {
  const server = http.createServer(async (req, res) => {
    try {
      if (!req.url || !req.method) return json(res, 400, { error: 'Bad request' });

      const { url, method } = req;

      // Healthcheck endpoint (без аутентификации)
      if (method === 'GET' && url === '/health') {
        return json(res, 200, { status: 'ok', service: 'remnawave-api' });
      }

      // Для webhook endpoints нужно сначала прочитать тело для проверки подписи
      let bodyBuffer: Buffer | undefined;
      if (method === 'POST' && url?.includes('/api/remnawave')) {
        try {
          bodyBuffer = await readBody(req);
        } catch (e: any) {
          logger.error('[Remnawave API] Failed to read body:', e);
          return json(res, 400, { error: 'Failed to read request body' });
        }
      }

      if (!(await assertAuth(req, res, bodyBuffer))) return;

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
        if (!backend) {
          return json(res, 503, { error: 'Backend не настроен. Укажите BACKEND_BASE_URL и BACKEND_TOKEN в .env для интеграции с веб-приложением' });
        }

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
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'remnawave-api.ts:332',message:'webhook subscriptions/status received',data:{url:req.url,method:req.method,allHeaderNames:Object.keys(req.headers)},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        const items = bodyBuffer ? JSON.parse(bodyBuffer.toString('utf8')) : await readJsonBody(req) as Array<{ remnawaveSubscriptionId: string; status: 'active' | 'expired' | 'cancelled' }>;
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'remnawave-api.ts:335',message:'webhook body parsed',data:{itemsCount:items?.length || 0},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        if (!Array.isArray(items) || items.length === 0) {
          return json(res, 400, { error: 'Body must be a non-empty array' });
        }
        
        for (const item of items) {
          if (!item?.remnawaveSubscriptionId || !item?.status) continue;
          
          // Обновляем статус в БД
          queries.updateRemnawaveStatus.run({
            status: item.status,
            remnawave_subscription_id: item.remnawaveSubscriptionId,
          });
          
          // Если подписка истекла или отменена - удаляем MTProto секреты
          if (item.status === 'expired' || item.status === 'cancelled') {
            const bindings = queries.getRemnawaveBindingsBySubscriptionId.all(item.remnawaveSubscriptionId) as any[];
            for (const binding of bindings) {
              if (binding.telegram_id) {
                const userId = binding.telegram_id;
                const activeSubs = queries.getActiveUserSubscriptions.all(userId) as any[];
                const otherRemnawaveBindings = queries.getRemnawaveBindingsByTelegramId.all(userId) as any[];
                const hasOtherActive = activeSubs.length > 0 || otherRemnawaveBindings.some(b => 
                  b.id !== binding.id && b.status === 'active' && b.remnawave_subscription_id !== item.remnawaveSubscriptionId
                );
                
                // Если нет других активных подписок - полностью удаляем MTProto
                if (!hasOtherActive) {
                  logger.info(`[Remnawave API] Полное удаление MTProto для пользователя ${userId} (webhook: ${item.status})`);
                  await MtprotoUserManager.deleteUserCompletely(userId);
                  
                  // Удаляем user_subscription для этой подписки
                  const userSubs = queries.getUserSubscriptions.all(userId) as any[];
                  for (const userSub of userSubs) {
                    if (userSub.local_subscription_id === binding.local_subscription_id) {
                      queries.deleteUserSubscription.run(userSub.id);
                    }
                  }
                }
              }
            }
          }
        }
        logger.info(`[Remnawave API] Updated ${items.length} subscription statuses`);
        return json(res, 200, { success: true, updated: items.length });
      }
      
      // Обработка webhook событий Remnawave (user.deleted, user.expired и т.д.)
      // Согласно документации: https://docs.rw/docs/features/webhooks/
      // Remnawave отправляет события в формате: { scope, event, timestamp, data }
      // Webhook может приходить на любой endpoint, указанный в WEBHOOK_URL
      // Поэтому проверяем все POST запросы на /api/remnawave/* endpoints
      if (method === 'POST' && url?.startsWith('/api/remnawave/')) {
        // Пытаемся распарсить как событие Remnawave
        let eventData: any;
        try {
          eventData = bodyBuffer ? JSON.parse(bodyBuffer.toString('utf8')) : await readJsonBody(req);
        } catch (e: any) {
          // Если не JSON - это не событие Remnawave, пропускаем
          eventData = null;
        }
        
        // Если это событие Remnawave (имеет scope и event) - обрабатываем его
        if (eventData && eventData.scope && eventData.event) {
          // #region agent log
          fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'remnawave-api.ts:450',message:'webhook event received',data:{url:req.url,scope:eventData.scope,event:eventData.event},timestamp:Date.now(),hypothesisId:'E'})}).catch(()=>{});
          // #endregion
          
          // Обрабатываем события пользователя
          if (eventData.scope === 'user' && eventData.data) {
            const { uuid, telegramId, status } = eventData.data;
            
            // События удаления или истечения пользователя
            if (eventData.event === 'user.deleted' || eventData.event === 'user.expired' || eventData.event === 'user.revoked') {
              if (telegramId) {
                logger.info(`[Remnawave API] Webhook: ${eventData.event} для пользователя ${telegramId}`);
                
                // Находим все привязки для этого пользователя
                const bindings = queries.getRemnawaveBindingsByTelegramId.all(telegramId) as any[];
                
                // Проверяем, есть ли другие активные подписки
                const activeSubs = queries.getActiveUserSubscriptions.all(telegramId) as any[];
                const hasOtherActive = activeSubs.length > 0 || bindings.some(b => b.status === 'active');
                
                // Если нет других активных подписок - полностью удаляем MTProto
                if (!hasOtherActive) {
                  logger.info(`[Remnawave API] Полное удаление MTProto для пользователя ${telegramId} (webhook: ${eventData.event})`);
                  await MtprotoUserManager.deleteUserCompletely(telegramId);
                  
                  // Удаляем все user_subscription для этого пользователя
                  const userSubs = queries.getUserSubscriptions.all(telegramId) as any[];
                  for (const userSub of userSubs) {
                    queries.deleteUserSubscription.run(userSub.id);
                  }
                }
                
                // Помечаем все привязки как expired
                for (const binding of bindings) {
                  queries.updateRemnawaveStatus.run({
                    status: 'expired',
                    remnawave_subscription_id: binding.remnawave_subscription_id,
                  });
                }
              }
            }
          }
          
          return json(res, 200, { success: true, event: eventData.event });
        }
        
        // Если это не событие Remnawave - продолжаем обработку других endpoints
      }
      
      // Обработка webhook событий на отдельном endpoint (для обратной совместимости)
      if (method === 'POST' && url === '/api/remnawave/webhook') {
        const event = bodyBuffer ? JSON.parse(bodyBuffer.toString('utf8')) : await readJsonBody(req) as {
          scope?: string;
          event?: string;
          timestamp?: string;
          data?: {
            uuid?: string;
            telegramId?: number;
            status?: string;
            expireAt?: string;
            subscriptionUrl?: string;
            [key: string]: any;
          };
        };
        
        // Обрабатываем события пользователя
        if (event.scope === 'user' && event.data) {
          const { uuid, telegramId, status } = event.data;
          
          // События удаления или истечения пользователя
          if (event.event === 'user.deleted' || event.event === 'user.expired' || event.event === 'user.revoked') {
            if (telegramId) {
              logger.info(`[Remnawave API] Webhook: ${event.event} для пользователя ${telegramId}`);
              
              // Находим все привязки для этого пользователя
              const bindings = queries.getRemnawaveBindingsByTelegramId.all(telegramId) as any[];
              
              // Проверяем, есть ли другие активные подписки
              const activeSubs = queries.getActiveUserSubscriptions.all(telegramId) as any[];
              const hasOtherActive = activeSubs.length > 0 || bindings.some(b => b.status === 'active');
              
              // Если нет других активных подписок - полностью удаляем MTProto
              if (!hasOtherActive) {
                logger.info(`[Remnawave API] Полное удаление MTProto для пользователя ${telegramId} (webhook: ${event.event})`);
                await MtprotoUserManager.deleteUserCompletely(telegramId);
                
                // Удаляем все user_subscription для этого пользователя
                const userSubs = queries.getUserSubscriptions.all(telegramId) as any[];
                for (const userSub of userSubs) {
                  queries.deleteUserSubscription.run(userSub.id);
                }
              }
              
              // Помечаем все привязки как expired
              for (const binding of bindings) {
                queries.updateRemnawaveStatus.run({
                  status: 'expired',
                  remnawave_subscription_id: binding.remnawave_subscription_id,
                });
              }
            }
          }
        }
        
        return json(res, 200, { success: true });
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


