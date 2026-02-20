import { Telegraf, Markup, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { queries } from './database';
import { NodeApiClient, ProxyLinkGenerator, SecretGenerator } from './node-client';
import { SubscriptionManager, SubscriptionFormatter } from './subscription-manager';
import cron from 'node-cron';
import crypto from 'crypto';
import { getBackendClientFromEnv } from './backend-client';
import { MtprotoUserManager } from './mtproto-user-manager';
import { SalesManager } from './sales-manager';
import { DEFAULT_PRODUCTS, formatProductList, getProductById } from './products';
import { createYooMoneyPaymentLink, checkYooMoneyPayment, activateAfterPayment, pendingPayments, startPaymentPolling } from './payment-handler';
import { logger } from './logger';

// ─── Конфиг ───
const BOT_TOKEN = process.env.BOT_TOKEN!;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim())).filter(id => id > 0);
const YOOMONEY_TOKEN = process.env.YOOMONEY_TOKEN || '';
const YOOMONEY_WALLET = process.env.YOOMONEY_WALLET || '';

if (!BOT_TOKEN || ADMIN_IDS.length === 0) {
  logger.error('❌ BOT_TOKEN и ADMIN_IDS обязательны в .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Хранилище клиентов для нод (кэш)
const nodeClients = new Map<number, NodeApiClient>();

// Функция для экранирования HTML символов
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Функция для конвертации Markdown в HTML (для совместимости)
function markdownToHtml(text: string): string {
  // Экранируем HTML символы сначала
  let html = escapeHtml(text);
  // Заменяем Markdown на HTML
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); // **bold**
  html = html.replace(/\*(.+?)\*/g, '<b>$1</b>'); // *bold*
  html = html.replace(/`(.+?)`/g, '<code>$1</code>'); // `code`
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>'); // [text](url)
  return html;
}

/**
 * Получить клиент для ноды
 */
function getNodeClient(nodeId: number): NodeApiClient | null {
  if (nodeClients.has(nodeId)) {
    return nodeClients.get(nodeId)!;
  }

  const node = queries.getNodeById.get(nodeId) as any;
  if (!node) return null;

  const client = new NodeApiClient({
    id: node.id,
    name: node.name,
    apiUrl: node.api_url,
    apiToken: node.api_token,
  });

  nodeClients.set(nodeId, client);
  return client;
}

/**
 * Проверка прав админа
 */
function isAdmin(userId: number): boolean {
  return ADMIN_IDS.includes(userId);
}

/**
 * Middleware для проверки админа
 */
bot.use(async (ctx, next) => {
  if (!ctx.from) return;
  
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('⛔ У вас нет доступа к этому боту.');
    return;
  }

  return next();
});

// ═══════════════════════════════════════════════
// ОСНОВНЫЕ КОМАНДЫ
// ═══════════════════════════════════════════════

bot.start(async (ctx) => {
  const userId = ctx.from.id;
  
  // Если пользователь - показываем меню продаж
  if (!isAdmin(userId)) {
    return handleUserStart(ctx);
  }

  // Если админ - показываем админ-меню
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Продажи', 'menu_sales'), Markup.button.callback('📡 Ноды', 'menu_nodes')],
    [Markup.button.callback('📦 Подписки', 'menu_subscriptions'), Markup.button.callback('👤 Пользователи', 'menu_users')],
    [Markup.button.callback('➕ Создать MTProto', 'menu_create_mtproto'), Markup.button.callback('📊 Статистика', 'menu_stats')],
    [Markup.button.callback('⚙️ Настройки', 'menu_settings')],
  ]);

  await ctx.reply(
    '👋 <b>MTProxy Management Bot</b>\n\n' +
    'Выберите раздел для управления:\n\n' +
    '💡 Все действия доступны через кнопки меню!',
    { parse_mode: 'HTML', ...keyboard }
  );
});

// Обработчик старта для обычных пользователей
async function handleUserStart(ctx: any) {
  const userId = ctx.from.id;
  
  // Проверяем активные подписки
  const userSubs = SalesManager.getUserSubscriptions(userId);
  const remnawaveBindings = queries.getRemnawaveBindingsByTelegramId.all(userId) as any[];
  const hasRemnawave = remnawaveBindings.some(b => b.status === 'active');
  
  if (userSubs.length > 0 || hasRemnawave) {
    // У пользователя есть активная подписка
    const secrets = queries.getUserMtprotoSecretsByTelegramId.all(userId) as any[];
    const links: string[] = [];
    
    for (const secret of secrets) {
      const node = queries.getNodeById.get(secret.node_id) as any;
      if (node) {
        links.push(ProxyLinkGenerator.generateMtProtoLink(
          node.domain,
          node.mtproto_port,
          secret.secret,
          secret.is_fake_tls === 1
        ));
      }
    }
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📋 Тарифы', 'cmd_tariffs')],
      [Markup.button.callback('📊 Мой статус', 'cmd_status')],
    ]);
    
    let text = '✅ <b>У вас есть активная подписка!</b>\n\n';
    text += `🔗 <b>Ваши ссылки:</b>\n`;
    for (const link of links) {
      text += `<code>${escapeHtml(link)}</code>\n`;
    }
    text += `\n📊 /status — статус подписки\n`;
    text += `💰 /tariffs — продлить подписку`;
    
    return ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  }
  
  // Нет активной подписки - показываем тарифы
  return handleTariffs(ctx);
}

bot.help(async (ctx) => {
  await ctx.reply(
    '📖 <b>Справка по командам</b>\n\n' +
    '<b>Управление нодами:</b>\n' +
    '/nodes - список всех нод\n' +
    '/add\\_node - добавить новую ноду\n' +
    '/node &lt;id&gt; - информация о ноде\n' +
    '/remove\\_node &lt;id&gt; - удалить ноду\n' +
    '/restart\\_node &lt;id&gt; - перезапустить прокси\n\n' +
    '<b>Получение доступов:</b>\n' +
    '/links &lt;node\\_id&gt; - получить все ссылки\n' +
    '/add\\_secret &lt;node\\_id&gt; - добавить секрет\n' +
    '/add\\_socks5 &lt;node\\_id&gt; - добавить SOCKS5 аккаунт\n\n' +
    '<b>Подписки:</b>\n' +
    '/create\\_subscription &lt;название&gt; - создать подписку\n' +
    '/subscriptions - список всех подписок\n' +
    '/subscription &lt;id&gt; - детали подписки\n\n' +
    '<b>Мониторинг:</b>\n' +
    '/stats - общая статистика\n' +
    '/health - здоровье всех нод\n' +
    '/logs &lt;node\\_id&gt; - логи ноды\n\n' +
    '<b>Настройки:</b>\n' +
    '/set\\_workers <node\\_id> <count> - воркеры\n' +
    '/update\\_node <id> - обновить конфиг',
    { parse_mode: 'HTML' }
  );
});

// ═══════════════════════════════════════════════
// MTProto Users (персональные доступы)
// ═══════════════════════════════════════════════

bot.command('user_mtproxy', async (ctx) => {
  const arg = ctx.message.text.split(' ')[1];
  const telegramId = parseInt(arg || '', 10);
  if (!telegramId) {
    return ctx.reply('Использование: /user_mtproxy <telegram_id>');
  }

  const bindings = queries.getRemnawaveBindingsByTelegramId.all(telegramId) as any[];
  const secrets = queries.getUserMtprotoSecretsByTelegramId.all(telegramId) as any[];

  let text = `👤 <b>MTProto user</b>\n\n` +
    `<b>TG ID:</b> <code>${telegramId}</code>\n` +
    `<b>Bindings:</b> ${bindings.length}\n` +
    `<b>Secrets:</b> ${secrets.length}\n\n`;

  if (bindings.length > 0) {
    const b = bindings[0];
    text += `<b>Status:</b> ${b.status}\n`;
    text += `<b>RemnaSubId:</b> <code>${b.remnawave_subscription_id}</code>\n`;
    text += `<b>BackendUser:</b> <code>${b.remnawave_user_id}</code>\n`;
    text += `<b>LocalSub:</b> <code>${b.local_subscription_id}</code>\n\n`;
  }

  if (secrets.length === 0) {
    text += '📭 Нет активных персональных секретов.\n';
    return ctx.reply(text, { parse_mode: 'HTML' });
  }

  text += '<b>Links:</b>\n';
  for (const s of secrets) {
    const node = queries.getNodeById.get(s.node_id) as any;
    if (!node) continue;
    const link = ProxyLinkGenerator.generateMtProtoLink(
      node.domain,
      node.mtproto_port,
      s.secret,
      s.is_fake_tls === 1
    );
    text += `- Node <code>${node.id}</code>: ${escapeHtml(link)}\n`;
  }

  return ctx.reply(text, { parse_mode: 'HTML' });
});

bot.command('disable_mtproxy', async (ctx) => {
  const arg = ctx.message.text.split(' ')[1];
  const telegramId = parseInt(arg || '', 10);
  if (!telegramId) {
    return ctx.reply('Использование: /disable_mtproxy <telegram_id>');
  }

  await MtprotoUserManager.disableUser(telegramId);
  return ctx.reply(`✅ Доступ MTProto для TG ID ${telegramId} отключён (секреты удалены с нод).`);
});

// Обработчик информации о пользователе
bot.action(/^user_info_(\d+)$/, async (ctx) => {
  const telegramId = parseInt(ctx.match[1], 10);
  const bindings = queries.getRemnawaveBindingsByTelegramId.all(telegramId) as any[];
  const secrets = queries.getUserMtprotoSecretsByTelegramId.all(telegramId) as any[];

  let text = `👤 <b>Информация о пользователе</b>\n\n`;
  text += `<b>TG ID:</b> <code>${telegramId}</code>\n`;
  text += `<b>Привязок:</b> ${bindings.length}\n`;
  text += `<b>Секретов:</b> ${secrets.length}\n\n`;

  if (bindings.length > 0) {
    text += `<b>Привязки Remnawave:</b>\n`;
    for (const b of bindings) {
      text += `• Подписка: <code>${b.remnawave_subscription_id}</code>\n`;
      text += `  Статус: ${b.status === 'active' ? '✅' : '❌'}\n`;
      text += `  UUID: <code>${b.remnawave_user_id}</code>\n\n`;
    }
  }

  if (secrets.length > 0) {
    text += `<b>MTProto секреты:</b>\n`;
    for (const s of secrets) {
      const node = queries.getNodeById.get(s.node_id) as any;
      const link = ProxyLinkGenerator.generateMtProtoLink(
        node?.domain || 'N/A',
        node?.mtproto_port || 443,
        s.secret,
        s.is_fake_tls === 1
      );
      text += `• Нода ${s.node_id}: <code>${escapeHtml(s.secret)}</code>\n`;
      text += `  ${escapeHtml(link)}\n\n`;
    }
  } else {
    text += `📭 Нет активных персональных секретов.\n`;
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('❌ Отключить доступ', `mtproto_disable_${telegramId}`)],
    [Markup.button.callback('🔙 Главное меню', 'menu_main')],
  ]);

  await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
  await ctx.answerCbQuery();
});

// Обработчик кнопки отключения MTProto
bot.action(/^mtproto_disable_(\d+)$/, async (ctx) => {
  const telegramId = parseInt(ctx.match[1], 10);
  try {
    await MtprotoUserManager.disableUser(telegramId);
    await ctx.editMessageText(
      `✅ Доступ MTProto для TG ID ${telegramId} отключён.\n\nСекреты удалены со всех нод.`,
      { parse_mode: 'HTML' }
    );
    await ctx.answerCbQuery('Отключено');
  } catch (err: any) {
    await ctx.answerCbQuery(`Ошибка: ${err.message}`);
  }
});

// Обработчик кнопки отмены
bot.action('cancel', async (ctx) => {
  await ctx.editMessageText('❌ Действие отменено.');
  await ctx.answerCbQuery();
});

bot.command('search_mtproxy', async (ctx) => {
  const arg = ctx.message.text.split(' ').slice(1).join(' ');
  if (!arg) {
    return ctx.reply('Использование: /search_mtproxy <секрет|telegram_id|uuid>\nПримеры:\n/search_mtproxy dd1234567890abcdef\n/search_mtproxy 123456789\n/search_mtproxy abc-def-ghi');
  }

  // Поиск по секрету
  const bySecret = queries.getUserMtprotoSecretBySecret.get(arg) as any;
  if (bySecret) {
    const node = queries.getNodeById.get(bySecret.node_id) as any;
    const bindings = queries.getRemnawaveBindingsByTelegramId.all(bySecret.telegram_id) as any[];
    let text = `🔍 <b>Найден MTProto секрет</b>\n\n`;
    text += `<b>Секрет:</b> <code>${escapeHtml(bySecret.secret)}</code>\n`;
    text += `<b>Telegram ID:</b> ${bySecret.telegram_id}\n`;
    text += `<b>Нода:</b> ${escapeHtml(node?.name || 'N/A')} (ID: ${bySecret.node_id})\n`;
    text += `<b>Статус:</b> ${bySecret.is_active ? '✅ Активен' : '❌ Неактивен'}\n`;
    text += `<b>Fake TLS:</b> ${bySecret.is_fake_tls ? 'Да' : 'Нет'}\n`;
    text += `<b>Создан:</b> ${bySecret.created_at}\n\n`;
    
    if (bindings.length > 0) {
      text += `<b>Привязки Remnawave:</b>\n`;
      for (const b of bindings) {
        text += `- Подписка: ${escapeHtml(b.remnawave_subscription_id)}\n`;
        text += `  Статус: ${b.status}\n`;
      }
    }
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('❌ Отключить доступ', `mtproto_disable_${bySecret.telegram_id}`)]
    ]);
    
    return ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  }

  // Поиск по Telegram ID
  const tgId = parseInt(arg, 10);
  if (!isNaN(tgId)) {
    const secrets = queries.getUserMtprotoSecretsByTelegramId.all(tgId) as any[];
    if (secrets.length > 0) {
      let text = `🔍 <b>Найдено секретов для TG ID ${tgId}:</b> ${secrets.length}\n\n`;
      for (const s of secrets) {
        const node = queries.getNodeById.get(s.node_id) as any;
        text += `<b>Нода:</b> ${escapeHtml(node?.name || 'N/A')}\n`;
        text += `<b>Секрет:</b> <code>${escapeHtml(s.secret)}</code>\n`;
        text += `<b>Статус:</b> ${s.is_active ? '✅' : '❌'}\n\n`;
      }
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('❌ Отключить все', `mtproto_disable_${tgId}`)]
      ]);
      return ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    }
  }

  // Поиск по UUID (через remnawave_bindings)
  const byUuid = queries.getRemnawaveBindingsByUserId.all(arg) as any[];
  if (byUuid.length > 0) {
    let text = `🔍 <b>Найдено привязок для UUID:</b> ${escapeHtml(arg)}\n\n`;
    for (const b of byUuid) {
      const sub = queries.getSubscriptionById.get(b.local_subscription_id) as any;
      const secrets = b.telegram_id ? queries.getUserMtprotoSecretsByTelegramId.all(b.telegram_id) as any[] : [];
      text += `<b>Подписка Remnawave:</b> ${escapeHtml(b.remnawave_subscription_id)}\n`;
      text += `<b>Локальная подписка:</b> ${escapeHtml(sub?.name || 'N/A')} (ID: ${b.local_subscription_id})\n`;
      text += `<b>Telegram ID:</b> ${b.telegram_id || 'N/A'}\n`;
      text += `<b>Статус:</b> ${b.status}\n`;
      text += `<b>Секретов MTProto:</b> ${secrets.length}\n\n`;
    }
    return ctx.reply(text, { parse_mode: 'HTML' });
  }

  return ctx.reply('❌ Ничего не найдено. Проверьте правильность ввода.');
});

bot.command('subscription_mtproxy', async (ctx) => {
  const arg = ctx.message.text.split(' ')[1];
  const localSubId = parseInt(arg || '', 10);
  if (!localSubId) {
    return ctx.reply('Использование: /subscription_mtproxy <local_subscription_id>');
  }

  const sub = queries.getSubscriptionById.get(localSubId) as any;
  if (!sub) return ctx.reply('❌ Подписка не найдена');

  const bindings = queries.getRemnawaveBindingsByLocalSubscriptionId.all(localSubId) as any[];
  const active = bindings.filter(b => b.status === 'active');
  const expired = bindings.filter(b => b.status !== 'active');

  let text = `📦 <b>Local subscription</b>\n\n` +
    `<b>ID:</b> <code>${localSubId}</code>\n` +
    `<b>Name:</b> ${escapeHtml(sub.name)}\n` +
    `<b>Bindings:</b> ${bindings.length} (active: ${active.length}, inactive: ${expired.length})\n\n`;

  text += '<b>Последние 10:</b>\n';
  for (const b of bindings.slice(0, 10)) {
    text += `- tg:<code>${b.telegram_id ?? 'n/a'}</code> status:${b.status} remna:<code>${escapeHtml(b.remnawave_subscription_id)}</code>\n`;
  }

  return ctx.reply(text, { parse_mode: 'HTML' });
});

// ═══════════════════════════════════════════════
// УПРАВЛЕНИЕ НОДАМИ
// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════
// ИНТЕРАКТИВНОЕ МЕНЮ
// ═══════════════════════════════════════════════

// Главное меню
bot.action('menu_main', async (ctx) => {
  const userId = ctx.from.id;
  
  // Если пользователь - показываем меню продаж
  if (!isAdmin(userId)) {
    return handleUserStart(ctx);
  }

  // Если админ - показываем админ-меню
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Продажи', 'menu_sales'), Markup.button.callback('📡 Ноды', 'menu_nodes')],
    [Markup.button.callback('📦 Подписки', 'menu_subscriptions'), Markup.button.callback('👤 Пользователи', 'menu_users')],
    [Markup.button.callback('➕ Создать MTProto', 'menu_create_mtproto'), Markup.button.callback('📊 Статистика', 'menu_stats')],
    [Markup.button.callback('⚙️ Настройки', 'menu_settings')],
  ]);

  await ctx.editMessageText(
    '👋 <b>MTProxy Management Bot</b>\n\nВыберите раздел:\n\n' +
    '💡 Все действия доступны через кнопки меню!',
    { parse_mode: 'HTML', ...keyboard }
  );
  await ctx.answerCbQuery();
});

// Меню нод
bot.action('menu_nodes', async (ctx) => {
  // #region agent log
  const callbackData = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
  fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bot.ts:455',message:'menu_nodes action called',data:{userId:ctx.from?.id,callbackData},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  try {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bot.ts:457',message:'Checking queries.getAllNodes',data:{hasGetAllNodes:!!queries.getAllNodes,type:typeof queries.getAllNodes},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    const nodes = queries.getAllNodes.all() as any[];
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bot.ts:460',message:'getAllNodes query executed',data:{nodesCount:nodes?.length || 0},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    if (nodes.length === 0) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('➕ Добавить ноду', 'node_add')],
      [Markup.button.callback('🔙 Главное меню', 'menu_main')],
    ]);
    await ctx.editMessageText(
      '📡 <b>Ноды</b>\n\n📭 Нет добавленных нод.',
      { parse_mode: 'HTML', ...keyboard }
    );
    await ctx.answerCbQuery();
    return;
  }

  const buttons = nodes.map(node => {
    const statusEmoji = node.status === 'online' ? '🟢' : 
                       node.status === 'offline' ? '🔴' : '🟡';
    return [Markup.button.callback(
      `${statusEmoji} ${node.name} (${node.domain})`,
      `node_info_${node.id}`
    )];
  });

  const keyboard = Markup.inlineKeyboard([
    ...buttons,
    [Markup.button.callback('➕ Добавить ноду', 'node_add')],
    [Markup.button.callback('🔙 Главное меню', 'menu_main')],
  ]);

    let text = '📡 <b>Список нод:</b>\n\n';
    for (const node of nodes) {
      const statusEmoji = node.status === 'online' ? '🟢' : 
                         node.status === 'offline' ? '🔴' : '🟡';
      text += `${statusEmoji} <b>${escapeHtml(node.name)}</b>\n`;
      text += `   Домен: <code>${escapeHtml(node.domain)}</code>\n`;
      text += `   Статус: ${node.status}\n\n`;
    }

    await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    await ctx.answerCbQuery();
  } catch (error: any) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bot.ts:507',message:'menu_nodes error',data:{error:error?.message,stack:error?.stack,name:error?.name},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    logger.error('Ошибка в menu_nodes:', error);
    await ctx.answerCbQuery('Ошибка при получении списка нод', { show_alert: true }).catch(() => {});
  }
});

bot.command('nodes', async (ctx) => {
  const nodes = queries.getAllNodes.all() as any[];
  
  if (nodes.length === 0) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('➕ Добавить ноду', 'node_add')],
      [Markup.button.callback('🔙 Главное меню', 'menu_main')],
    ]);
    return ctx.reply('📡 <b>Ноды</b>\n\n📭 Нет добавленных нод.', { parse_mode: 'HTML', ...keyboard });
  }

  const buttons = nodes.map(node => {
    const statusEmoji = node.status === 'online' ? '🟢' : 
                       node.status === 'offline' ? '🔴' : '🟡';
    return [Markup.button.callback(
      `${statusEmoji} ${node.name} (${node.domain})`,
      `node_info_${node.id}`
    )];
  });

  const keyboard = Markup.inlineKeyboard([
    ...buttons,
    [Markup.button.callback('➕ Добавить ноду', 'node_add')],
    [Markup.button.callback('🔙 Главное меню', 'menu_main')],
  ]);

  let text = '📡 <b>Список нод:</b>\n\n';
  for (const node of nodes) {
    const statusEmoji = node.status === 'online' ? '🟢' : 
                       node.status === 'offline' ? '🔴' : '🟡';
    text += `${statusEmoji} <b>${escapeHtml(node.name)}</b>\n`;
    text += `   Домен: <code>${escapeHtml(node.domain)}</code>\n`;
    text += `   Статус: ${node.status}\n\n`;
  }

  await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
});

// Обработчик кнопки информации о ноде
bot.action(/^node_info_(\d+)$/, async (ctx) => {
  const nodeId = parseInt(ctx.match[1], 10);
  const node = queries.getNodeById.get(nodeId) as any;
  if (!node) {
    await ctx.answerCbQuery('Нода не найдена');
    return;
  }

  const client = getNodeClient(nodeId);
  let healthInfo = '';
  let statsInfo = '';

  try {
    if (client) {
      const health = await client.getHealth();
      const stats = await client.getStats();
      
      healthInfo = `\n<b>Статус:</b> ${health.status === 'healthy' ? '✅ Здорова' : '⚠️ Проблемы'}\n` +
                   `<b>Uptime:</b> ${Math.floor(health.uptime / 3600)}ч ${Math.floor((health.uptime % 3600) / 60)}м\n` +
                   `<b>CPU:</b> ${health.system.cpuUsage.toFixed(1)}%\n` +
                   `<b>RAM:</b> ${health.system.ramUsage.toFixed(1)}%\n` +
                   `<b>Disk:</b> ${health.system.diskUsage.toFixed(1)}%\n`;
      
      statsInfo = `\n<b>Статистика:</b>\n` +
                  `MTProto подключений: ${stats.mtproto.connections}/${stats.mtproto.maxConnections}\n` +
                  `SOCKS5 подключений: ${stats.socks5.connections}\n` +
                  `Трафик: ↓${stats.network.inMb.toFixed(2)}MB ↑${stats.network.outMb.toFixed(2)}MB\n`;
    }
  } catch (err: any) {
    healthInfo = `\n⚠️ Не удалось получить данные: ${err.message}\n`;
  }

  const statusEmoji = node.status === 'online' ? '🟢' : 
                     node.status === 'offline' ? '🔴' : '🟡';

  let text = `📡 <b>Информация о ноде</b>\n\n`;
  text += `${statusEmoji} <b>${escapeHtml(node.name)}</b>\n`;
  text += `ID: <code>${node.id}</code>\n`;
  text += `Домен: <code>${escapeHtml(node.domain)}</code>\n`;
  text += `IP: <code>${escapeHtml(node.ip)}</code>\n`;
  text += `Порт MTProto: ${node.mtproto_port}\n`;
  text += `Порт SOCKS5: ${node.socks5_port}\n`;
  text += `Воркеры: ${node.workers}\n`;
  text += healthInfo;
  text += statsInfo;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Перезапустить', `node_restart_${nodeId}`)],
    [Markup.button.callback('🗑 Удалить', `node_delete_${nodeId}`)],
    [Markup.button.callback('🔙 К списку нод', 'menu_nodes')],
  ]);

  await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
  await ctx.answerCbQuery();
});

bot.command('node', async (ctx) => {
  const nodeId = parseInt(ctx.message.text.split(' ')[1]);
  if (!nodeId) {
    return ctx.reply('Использование: /node <id>');
  }

  const node = queries.getNodeById.get(nodeId) as any;
  if (!node) {
    return ctx.reply('❌ Нода не найдена');
  }

  const client = getNodeClient(nodeId);
  let healthInfo = '';
  let statsInfo = '';

  try {
    if (client) {
      const health = await client.getHealth();
      const stats = await client.getStats();
      
      healthInfo = `\n<b>Статус:</b> ${health.status === 'healthy' ? '✅ Здорова' : '⚠️ Проблемы'}\n` +
                   `<b>Uptime:</b> ${Math.floor(health.uptime / 3600)}ч ${Math.floor((health.uptime % 3600) / 60)}м\n` +
                   `<b>CPU:</b> ${health.system.cpuUsage.toFixed(1)}%\n` +
                   `<b>RAM:</b> ${health.system.ramUsage.toFixed(1)}%\n`;
      
      statsInfo = `\n<b>MTProto:</b>\n` +
                  `  Подключений: ${stats.mtproto.connections}/${stats.mtproto.maxConnections}\n` +
                  `  Telegram серверов: ${stats.mtproto.activeTargets}/${stats.mtproto.readyTargets}\n` +
                  `<b>SOCKS5:</b>\n` +
                  `  Подключений: ${stats.socks5.connections}\n` +
                  `<b>Трафик:</b>\n` +
                  `  ⬇️ ${stats.network.inMb.toFixed(2)} MB\n` +
                  `  ⬆️ ${stats.network.outMb.toFixed(2)} MB\n`;
    }
  } catch (err: any) {
    healthInfo = `\n⚠️ Не удалось получить статус: ${err.message}\n`;
  }

  await ctx.reply(
    `📡 <b>Нода: ${escapeHtml(node.name)}</b>\n\n` +
    `<b>ID:</b> <code>${node.id}</code>\n` +
    `<b>Домен:</b> <code>${escapeHtml(node.domain)}</code>\n` +
    `<b>IP:</b> <code>${escapeHtml(node.ip)}</code>\n` +
    `<b>MTProto порт:</b> ${node.mtproto_port}\n` +
    `<b>SOCKS5 порт:</b> ${node.socks5_port}\n` +
    `<b>Воркеры:</b> ${node.workers}\n` +
    `<b>CPU ядер:</b> ${node.cpu_cores}\n` +
    `<b>RAM:</b> ${node.ram_mb} MB\n` +
    healthInfo +
    statsInfo +
    `\n<b>Команды:</b>\n` +
    `/links ${node.id} - получить ссылки\n` +
    `/restart_node ${node.id} - перезапустить\n` +
    `/logs ${node.id} - показать логи`,
    { parse_mode: 'HTML' }
  );
});

bot.command('add_node', async (ctx) => {
  await ctx.reply(
    '➕ <b>Добавление новой ноды</b>\n\n' +
    'Отправьте данные ноды в формате:\n\n' +
    '```\n' +
    'name: My Node 1\n' +
    'domain: proxy1.example.com\n' +
    'ip: 1.2.3.4\n' +
    'api_url: https://proxy1.example.com:8080\n' +
    'mtproto_port: 443\n' +
    'socks5_port: 1080\n' +
    'workers: 4\n' +
    'cpu_cores: 4\n' +
    'ram_mb: 2048\n' +
    '```\n\n' +
    'API токен будет сгенерирован автоматически.',
    { parse_mode: 'HTML' }
  );
  
  // TODO: Реализовать conversation handler для добавления ноды
});

bot.command('remove_node', async (ctx) => {
  const nodeId = parseInt(ctx.message.text.split(' ')[1]);
  if (!nodeId) {
    return ctx.reply('Использование: /remove_node <id>');
  }

  const node = queries.getNodeById.get(nodeId) as any;
  if (!node) {
    return ctx.reply('❌ Нода не найдена');
  }

  await ctx.reply(
    `⚠️ Вы уверены, что хотите удалить ноду "${node.name}"?\n\n` +
    'Это удалит все секреты и аккаунты, связанные с этой нодой.\n\n' +
    'Отправьте "ДА" для подтверждения.',
    Markup.inlineKeyboard([
      [Markup.button.callback('✅ Да, удалить', `confirm_delete_${nodeId}`)],
      [Markup.button.callback('❌ Отмена', 'cancel')],
    ])
  );
});

bot.action(/^confirm_delete_(\d+)$/, async (ctx) => {
  const nodeId = parseInt(ctx.match[1]);
  
  queries.deleteNode.run(nodeId);
  nodeClients.delete(nodeId);
  
  await ctx.answerCbQuery('Нода удалена');
  await ctx.editMessageText('✅ Нода успешно удалена.');
  
  queries.insertLog.run({
    node_id: nodeId,
    level: 'info',
    message: 'Node deleted',
    details: `Admin ID: ${ctx.from!.id}`,
  });
});

bot.action('cancel', async (ctx) => {
  await ctx.answerCbQuery('Отменено');
  await ctx.editMessageText('❌ Операция отменена');
});

// ═══════════════════════════════════════════════
// ПОЛУЧЕНИЕ ДОСТУПОВ
// ═══════════════════════════════════════════════

bot.command('links', async (ctx) => {
  const nodeId = parseInt(ctx.message.text.split(' ')[1]);
  if (!nodeId) {
    return ctx.reply('Использование: /links <node_id>');
  }

  const node = queries.getNodeById.get(nodeId) as any;
  if (!node) {
    return ctx.reply('❌ Нода не найдена');
  }

  const secrets = queries.getNodeSecrets.all(nodeId) as any[];
  const socks5Accounts = queries.getNodeSocks5Accounts.all(nodeId) as any[];

  if (secrets.length === 0 && socks5Accounts.length === 0) {
    return ctx.reply(
      '📭 Нет доступов для этой ноды.\n\n' +
      `Добавьте:\n` +
      `/add_secret ${nodeId}\n` +
      `/add_socks5 ${nodeId}`
    );
  }

  let text = `🔗 <b>Доступы для ноды "${escapeHtml(node.name)}"</b>\n\n`;

  // MTProto секреты
  if (secrets.length > 0) {
    text += '<b>MTProto:</b>\n\n';
    for (const secret of secrets) {
      const type = secret.is_fake_tls ? '🔒 Fake-TLS (dd)' : '🔓 Обычный';
      const link = ProxyLinkGenerator.generateMtProtoLink(
        node.domain,
        node.mtproto_port,
        secret.secret,
        secret.is_fake_tls
      );
      const webLink = ProxyLinkGenerator.generateMtProtoWebLink(
        node.domain,
        node.mtproto_port,
        secret.secret,
        secret.is_fake_tls
      );
      
      text += `${type}\n`;
      if (secret.description) text += `_${secret.description}_\n`;
      text += `\`${link}\`\n`;
      text += `[Подключить](${webLink})\n\n`;
    }
  }

  // SOCKS5 аккаунты
  if (socks5Accounts.length > 0) {
    text += '<b>SOCKS5:</b>\n\n';
    for (const account of socks5Accounts) {
      const tgLink = ProxyLinkGenerator.generateSocks5TgLink(
        node.domain,
        node.socks5_port,
        account.username,
        account.password
      );
      const tmeLink = ProxyLinkGenerator.generateSocks5TmeLink(
        node.domain,
        node.socks5_port,
        account.username,
        account.password
      );
      
      text += `👤 ${account.username}\n`;
      if (account.description) text += `_${account.description}_\n`;
      text += `\`${tgLink}\`\n`;
      text += `[Подключить](${tmeLink})\n\n`;
    }
  }

  await ctx.reply(text, { parse_mode: 'HTML' });
});

bot.command('add_secret', async (ctx) => {
  const nodeId = parseInt(ctx.message.text.split(' ')[1]);
  if (!nodeId) {
    return ctx.reply('Использование: /add_secret <node_id>');
  }

  const node = queries.getNodeById.get(nodeId) as any;
  if (!node) {
    return ctx.reply('❌ Нода не найдена');
  }

  // Генерируем секрет
  const secret = SecretGenerator.generateMtProtoSecret();
  
  await ctx.reply(
    `🔐 <b>Добавление MTProto секрета</b>\n\n` +
    `Нода: ${escapeHtml(node.name)}\n` +
    `Секрет: <code>${escapeHtml(secret)}</code>\n\n` +
    `Выберите тип:`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🔒 Fake-TLS (dd) - рекомендуется', `add_secret_dd_${nodeId}_${secret}`)],
        [Markup.button.callback('🔓 Обычный', `add_secret_normal_${nodeId}_${secret}`)],
        [Markup.button.callback('❌ Отмена', 'cancel')],
      ])
    }
  );
});

bot.action(/^add_secret_(dd|normal)_(\d+)_([a-f0-9]{32})$/, async (ctx) => {
  const isFakeTls = ctx.match[1] === 'dd';
  const nodeId = parseInt(ctx.match[2]);
  const secret = ctx.match[3];

  const node = queries.getNodeById.get(nodeId) as any;
  if (!node) {
    await ctx.answerCbQuery('Нода не найдена');
    return;
  }

  // Добавляем в БД
  queries.insertSecret.run({
    node_id: nodeId,
    secret,
    is_fake_tls: isFakeTls ? 1 : 0,
    description: isFakeTls ? 'Fake-TLS' : 'Normal',
  });

  // Отправляем на ноду
  const client = getNodeClient(nodeId);
  try {
    if (client) {
      await client.addMtProtoSecret({
        secret,
        isFakeTls,
        description: isFakeTls ? 'Fake-TLS' : 'Normal',
      });
      await client.restartMtProto();
    }
  } catch (err: any) {
    await ctx.answerCbQuery(`Ошибка: ${err.message}`, { show_alert: true });
    return;
  }

  const link = ProxyLinkGenerator.generateMtProtoLink(
    node.domain,
    node.mtproto_port,
    secret,
    isFakeTls
  );

  await ctx.answerCbQuery('Секрет добавлен!');
  await ctx.editMessageText(
    `✅ <b>Секрет успешно добавлен!</b>\n\n` +
    `Нода: ${escapeHtml(node.name)}\n` +
    `Тип: ${isFakeTls ? 'Fake-TLS (dd)' : 'Обычный'}\n\n` +
    `Ссылка:\n\`${link}\``,
    { parse_mode: 'HTML' }
  );

  queries.insertLog.run({
    node_id: nodeId,
    level: 'info',
    message: 'MTProto secret added',
    details: `Type: ${isFakeTls ? 'Fake-TLS' : 'Normal'}, Admin: ${ctx.from!.id}`,
  });
});

// ─── SOCKS5 ───

bot.command('add_socks5', async (ctx) => {
  const nodeId = parseInt(ctx.message.text.split(' ')[1]);
  if (!nodeId) {
    return ctx.reply('Использование: /add_socks5 <node_id>');
  }

  const node = queries.getNodeById.get(nodeId) as any;
  if (!node) {
    return ctx.reply('❌ Нода не найдена');
  }

  // Генерируем username и password
  const username = `user_${crypto.randomBytes(4).toString('hex')}`;
  const password = SecretGenerator.generatePassword();
  
  await ctx.reply(
    `🔐 <b>Добавление SOCKS5 аккаунта</b>\n\n` +
    `Нода: ${escapeHtml(node.name)}\n` +
    `Username: <code>${escapeHtml(username)}</code>\n` +
    `Password: \`${password}\`\n\n` +
    `Подтвердите добавление:`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Добавить', `add_socks5_confirm_${nodeId}_${username}_${password}`)],
        [Markup.button.callback('❌ Отмена', 'cancel')],
      ])
    }
  );
});

bot.action(/^add_socks5_confirm_(\d+)_([^_]+)_([^_]+)$/, async (ctx) => {
  const nodeId = parseInt(ctx.match[1]);
  const username = ctx.match[2];
  const password = ctx.match[3];

  const node = queries.getNodeById.get(nodeId) as any;
  if (!node) {
    await ctx.answerCbQuery('Нода не найдена');
    return;
  }

  const client = getNodeClient(nodeId);
  if (!client) {
    await ctx.answerCbQuery('Не удалось подключиться к ноде');
    return;
  }

  try {
    // Добавляем в БД
    queries.insertSocks5Account.run({
      node_id: nodeId,
      username,
      password,
      description: `Added by admin ${ctx.from!.id}`,
    });

    // Отправляем на Node Agent для обновления конфига
    await client.addSocks5Account({ username, password });

    // Генерируем ссылки
    const tgLink = `tg://socks?server=${node.domain}&port=${node.socks5_port}&user=${username}&pass=${password}`;
    const tmeLink = `https://t.me/socks?server=${node.domain}&port=${node.socks5_port}&user=${username}&pass=${password}`;

    await ctx.answerCbQuery('SOCKS5 аккаунт добавлен!');
    await ctx.editMessageText(
      `✅ <b>SOCKS5 аккаунт успешно добавлен!</b>\n\n` +
      `Нода: ${escapeHtml(node.name)}\n` +
      `Username: <code>${escapeHtml(username)}</code>\n` +
      `Password: <code>${escapeHtml(password)}</code>\n\n` +
      `<b>Ссылки для импорта:</b>\n` +
      `\`${tgLink}\`\n\n` +
      `\`${tmeLink}\``,
      { parse_mode: 'HTML' }
    );

    queries.insertLog.run({
      node_id: nodeId,
      level: 'info',
      message: 'SOCKS5 account added',
      details: `Username: ${username}, Admin: ${ctx.from!.id}`,
    });
  } catch (err: any) {
    await ctx.answerCbQuery('Ошибка при добавлении');
    await ctx.reply(`❌ Ошибка: ${err.message}`);
  }
});

// ═══════════════════════════════════════════════
// МОНИТОРИНГ
// ═══════════════════════════════════════════════

bot.command('stats', async (ctx) => {
  const nodes = queries.getActiveNodes.all() as any[];
  const allStats = queries.getAllNodesLatestStats.all() as any[];
  
  let text = '📊 <b>Общая статистика</b>\n\n';
  text += `Нод активно: ${nodes.length}\n\n`;

  let totalMtprotoConnections = 0;
  let totalSocks5Connections = 0;
  let totalNetworkIn = 0;
  let totalNetworkOut = 0;

  for (const stat of allStats) {
    totalMtprotoConnections += stat.mtproto_connections || 0;
    totalSocks5Connections += stat.socks5_connections || 0;
    totalNetworkIn += stat.network_in_mb || 0;
    totalNetworkOut += stat.network_out_mb || 0;
    
    text += `<b>${escapeHtml(stat.node_name)}</b>\n`;
    text += `  MTProto: ${stat.mtproto_connections}/${stat.mtproto_max}\n`;
    text += `  SOCKS5: ${stat.socks5_connections}\n`;
    text += `  CPU: ${stat.cpu_usage?.toFixed(1)}% | RAM: ${stat.ram_usage?.toFixed(1)}%\n`;
    text += `  Трафик: ↓${(stat.network_in_mb || 0).toFixed(2)}MB ↑${(stat.network_out_mb || 0).toFixed(2)}MB\n\n`;
  }

  text += `<b>Итого:</b>\n`;
  text += `MTProto подключений: ${totalMtprotoConnections}\n`;
  text += `SOCKS5 подключений: ${totalSocks5Connections}\n`;
  text += `Трафик: ↓${totalNetworkIn.toFixed(2)}MB ↑${totalNetworkOut.toFixed(2)}MB\n`;

  // Статистика по пользователям
  const activeUsers = queries.getActiveRemnawaveBindings.all() as any[];
  const totalSecrets = queries.getAllUserMtprotoSecretsAll.all() as any[];
  const activeSecrets = totalSecrets.filter(s => s.is_active === 1);

  text += `\n<b>Пользователи:</b>\n`;
  text += `Активных привязок: ${activeUsers.length}\n`;
  text += `Активных секретов: ${activeSecrets.length}\n`;

  await ctx.reply(text, { parse_mode: 'HTML' });
});

bot.command('health', async (ctx) => {
  const nodes = queries.getActiveNodes.all() as any[];
  
  let text = '🏥 <b>Здоровье нод</b>\n\n';

  for (const node of nodes) {
    const client = getNodeClient(node.id);
    let status = '🔴 Offline';
    let details = '';

    try {
      if (client) {
        const health = await client.getHealth();
        status = health.status === 'healthy' ? '🟢 Healthy' : '🟡 Issues';
        details = `CPU: ${health.system.cpuUsage.toFixed(1)}% | RAM: ${health.system.ramUsage.toFixed(1)}%`;
      }
    } catch (err: any) {
      status = '🔴 Error';
      details = err.message;
    }

    text += `<b>${escapeHtml(node.name)}</b>\n`;
    text += `Status: ${status}\n`;
    if (details) text += `${details}\n`;
    text += `\n`;
  }

  await ctx.reply(text, { parse_mode: 'HTML' });
});

bot.command('logs', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const nodeId = parseInt(args[0]);
  const lines = parseInt(args[1]) || 50;

  if (!nodeId) {
    return ctx.reply('Использование: /logs <node_id> [количество_строк]\nПример: /logs 1 100');
  }

  const node = queries.getNodeById.get(nodeId) as any;
  if (!node) {
    return ctx.reply('❌ Нода не найдена');
  }

  const client = getNodeClient(nodeId);
  if (!client) {
    return ctx.reply('❌ Не удалось подключиться к ноде');
  }

  try {
    await ctx.reply('⏳ Получение логов...');
    
    // Получаем логи
    const logs = await client.getLogs(lines);

    // Форматируем для Telegram (лимит 4096 символов)
    let text = `📋 <b>Логи ноды: ${escapeHtml(node.name)}</b>\n\n`;
    
    text += `<b>MTProxy (последние ${lines} строк):</b>\n`;
    text += '<pre>\n';
    text += escapeHtml(logs.mtproto.substring(Math.max(0, logs.mtproto.length - 1500))); // Последние 1500 символов
    text += '\n</pre>\n\n';
    
    text += `<b>SOCKS5 (последние ${lines} строк):</b>\n`;
    text += '<pre>\n';
    text += escapeHtml(logs.socks5.substring(Math.max(0, logs.socks5.length - 1500)));
    text += '\n</pre>';

    await ctx.reply(text, { parse_mode: 'HTML' });

  } catch (err: any) {
    await ctx.reply(`❌ Ошибка: ${err.message}`);
  }
});

bot.command('set_workers', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const nodeId = parseInt(args[0]);
  const workers = parseInt(args[1]);

  if (!nodeId || !workers || workers < 1 || workers > 16) {
    return ctx.reply(
      'Использование: /set_workers <node_id> <количество>\n' +
      'Количество воркеров: от 1 до 16\n' +
      'Рекомендуется: 1 воркер на 1 CPU ядро\n\n' +
      'Пример: /set_workers 1 4'
    );
  }

  const node = queries.getNodeById.get(nodeId) as any;
  if (!node) {
    return ctx.reply('❌ Нода не найдена');
  }

  const client = getNodeClient(nodeId);
  if (!client) {
    return ctx.reply('❌ Не удалось подключиться к ноде');
  }

  try {
    await ctx.reply(`⏳ Изменение количества воркеров на ${workers}...`);
    
    // Отправляем запрос на Node Agent
    await client.updateWorkers(workers);
    
    // Обновляем в БД
    queries.updateNode.run({
      id: nodeId,
      name: node.name,
      domain: node.domain,
      ip: node.ip,
      api_url: node.api_url,
      api_token: node.api_token,
      mtproto_port: node.mtproto_port,
      socks5_port: node.socks5_port,
      workers: workers,
      cpu_cores: node.cpu_cores,
      ram_mb: node.ram_mb
    });

    await ctx.reply(
      `✅ <b>Воркеры обновлены!</b>\n\n` +
      `Нода: ${escapeHtml(node.name)}\n` +
      `Воркеров: ${workers}\n` +
      `Max соединений: ${workers * 60000}\n\n` +
      `MTProxy перезапущен с новыми настройками.`,
      { parse_mode: 'HTML' }
    );

    queries.insertLog.run({
      node_id: nodeId,
      level: 'info',
      message: 'Workers updated',
      details: `Workers: ${workers}, Admin: ${ctx.from!.id}`,
    });

  } catch (err: any) {
    await ctx.reply(`❌ Ошибка: ${err.message}`);
  }
});

// ═══════════════════════════════════════════════
// УПРАВЛЕНИЕ ПОДПИСКАМИ
// ═══════════════════════════════════════════════

/**
 * Создать новую подписку
 * Использование: /create_subscription [название]
 */
bot.command('create_subscription', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const name = args.join(' ') || 'Новая подписка';

  // Получаем список активных нод для выбора
  const nodes = queries.getActiveNodes.all() as any[];
  
  if (nodes.length === 0) {
    await ctx.reply('⚠️ Нет активных нод. Сначала добавьте хотя бы одну ноду.');
    return;
  }

  // Кнопки для выбора нод (можно выбрать несколько)
  const buttons = nodes.map(node => 
    Markup.button.callback(`${node.name} (${node.domain})`, `sub_toggle_node_${node.id}`)
  );

  // Разбиваем на строки по 1 кнопке
  const keyboard = Markup.inlineKeyboard([
    ...buttons.map(btn => [btn]),
    [Markup.button.callback('✅ Создать подписку', 'sub_create_confirm')],
    [Markup.button.callback('❌ Отмена', 'cancel')]
  ]);

  // Сохраняем временное состояние в контексте (в реальном проекте лучше использовать сессии)
  await ctx.reply(
    `📝 <b>Создание подписки</b>\n\n` +
    `Название: ${escapeHtml(name)}\n\n` +
    `Выберите ноды, которые будут включены в подписку:`,
    { parse_mode: 'HTML', ...keyboard }
  );
});

/**
 * Список всех подписок
 */
// Меню подписок
bot.action('menu_subscriptions', async (ctx) => {
  const subscriptions = queries.getAllSubscriptions.all() as any[];

  if (subscriptions.length === 0) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('➕ Создать подписку', 'sub_create')],
      [Markup.button.callback('🔙 Главное меню', 'menu_main')],
    ]);
    await ctx.editMessageText(
      '📦 <b>Подписки</b>\n\n📭 Нет созданных подписок.',
      { parse_mode: 'HTML', ...keyboard }
    );
    await ctx.answerCbQuery();
    return;
  }

  const buttons = subscriptions.map(sub => {
    const status = sub.is_active ? '🟢' : '🔴';
    return [Markup.button.callback(
      `${status} ${sub.name}`,
      `sub_info_${sub.id}`
    )];
  });

  const keyboard = Markup.inlineKeyboard([
    ...buttons,
    [Markup.button.callback('➕ Создать подписку', 'sub_create')],
    [Markup.button.callback('🔙 Главное меню', 'menu_main')],
  ]);

  let text = '📦 <b>Список подписок</b>\n\n';
  for (const sub of subscriptions) {
    const status = sub.is_active ? '🟢' : '🔴';
    const nodeIds = JSON.parse(sub.node_ids || '[]');
    text += `${status} <b>${escapeHtml(sub.name)}</b>\n`;
    text += `   ID: <code>${sub.id}</code> | Нод: ${nodeIds.length}\n`;
    text += `   Обращений: ${sub.access_count}\n\n`;
  }

  await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
  await ctx.answerCbQuery();
});

bot.command('subscriptions', async (ctx) => {
  const subscriptions = queries.getAllSubscriptions.all() as any[];

  if (subscriptions.length === 0) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('➕ Создать подписку', 'sub_create')],
      [Markup.button.callback('🔙 Главное меню', 'menu_main')],
    ]);
    return ctx.reply('📦 <b>Подписки</b>\n\n📭 Нет созданных подписок.', { parse_mode: 'HTML', ...keyboard });
  }

  const buttons = subscriptions.map(sub => {
    const status = sub.is_active ? '🟢' : '🔴';
    return [Markup.button.callback(
      `${status} ${sub.name}`,
      `sub_info_${sub.id}`
    )];
  });

  const keyboard = Markup.inlineKeyboard([
    ...buttons,
    [Markup.button.callback('➕ Создать подписку', 'sub_create')],
    [Markup.button.callback('🔙 Главное меню', 'menu_main')],
  ]);

  let text = '📦 <b>Список подписок</b>\n\n';
  for (const sub of subscriptions) {
    const status = sub.is_active ? '🟢' : '🔴';
    const nodeIds = JSON.parse(sub.node_ids || '[]');
    text += `${status} <b>${escapeHtml(sub.name)}</b>\n`;
    text += `   ID: <code>${sub.id}</code> | Нод: ${nodeIds.length}\n`;
    text += `   Обращений: ${sub.access_count}\n\n`;
  }

  await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
});

/**
 * Детали подписки
 * Использование: /subscription <id>
 */
// Обработчик кнопки информации о подписке
bot.action(/^sub_info_(\d+)$/, async (ctx) => {
  const subId = parseInt(ctx.match[1], 10);
  const sub = queries.getSubscriptionById.get(subId) as any;
  
  if (!sub) {
    await ctx.answerCbQuery('Подписка не найдена');
    return;
  }

  try {
    const proxies = await SubscriptionManager.getSubscriptionProxies(subId);
    const info = SubscriptionFormatter.formatSubscriptionInfo(sub, proxies.length);
    const proxyList = SubscriptionFormatter.formatProxiesForTelegram(proxies);
    const links = SubscriptionManager.generateSubscriptionLinks(proxies);

    let text = `${info}\n\n`;
    text += `<b>Прокси:</b>\n${escapeHtml(proxyList)}\n\n`;
    text += `<b>Готовые ссылки:</b>\n`;
    
    for (const link of links) {
      text += `\`${link}\`\n`;
    }

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('📥 JSON для импорта', `sub_export_${subId}`),
        Markup.button.callback('🔄 Обновить', `sub_refresh_${subId}`)
      ],
      [
        Markup.button.callback(
          sub.is_active ? '⏸ Деактивировать' : '▶️ Активировать',
          `sub_toggle_${subId}`
        ),
        Markup.button.callback('🗑 Удалить', `sub_delete_${subId}`)
      ],
      [Markup.button.callback('👥 Пользователи', `sub_users_${subId}`)],
      [Markup.button.callback('🔙 К списку подписок', 'menu_subscriptions')],
    ]);

    await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    await ctx.answerCbQuery();
  } catch (err: any) {
    await ctx.answerCbQuery(`Ошибка: ${err.message}`);
  }
});

bot.command('subscription', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const subId = parseInt(args[0]);

  if (!subId) {
    await ctx.reply('❌ Укажите ID подписки: /subscription <id>');
    return;
  }

  const sub = queries.getSubscriptionById.get(subId) as any;
  
  if (!sub) {
    await ctx.reply('❌ Подписка не найдена');
    return;
  }

  try {
    // Получаем все прокси для подписки
    const proxies = await SubscriptionManager.getSubscriptionProxies(subId);
    
    // Форматируем для отображения
    const info = SubscriptionFormatter.formatSubscriptionInfo(sub, proxies.length);
    const proxyList = SubscriptionFormatter.formatProxiesForTelegram(proxies);

    // Генерируем ссылки
    const links = SubscriptionManager.generateSubscriptionLinks(proxies);

    let text = `${info}\n\n`;
    text += `<b>Прокси:</b>\n${escapeHtml(proxyList)}\n\n`;
    text += `<b>Готовые ссылки:</b>\n`;
    
    for (const link of links) {
      text += `\`${link}\`\n`;
    }

    // Кнопки управления
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('📥 JSON для импорта', `sub_export_${subId}`),
        Markup.button.callback('🔄 Обновить', `sub_refresh_${subId}`)
      ],
      [
        Markup.button.callback(
          sub.is_active ? '⏸ Деактивировать' : '▶️ Активировать',
          `sub_toggle_${subId}`
        ),
        Markup.button.callback('🗑 Удалить', `sub_delete_${subId}`)
      ]
    ]);

    await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });

  } catch (err: any) {
    await ctx.reply(`❌ Ошибка: ${err.message}`);
  }
});

/**
 * Действия с подписками (callback query)
 */

// Экспорт JSON для импорта в Telegram
bot.action(/^sub_export_(\d+)$/, async (ctx) => {
  const subId = parseInt(ctx.match[1]);

  try {
    const json = await SubscriptionManager.generateTelegramImportJson(subId);
    
    // Отправляем как файл
    await ctx.replyWithDocument(
      {
        source: Buffer.from(JSON.stringify(json, null, 2)),
        filename: `subscription_${subId}.json`
      },
      {
        caption: '📥 Импортируйте этот файл в Telegram:\n\n' +
                 'Settings → Advanced → Network and proxy → Import from file'
      }
    );

    await ctx.answerCbQuery('JSON сгенерирован!');

  } catch (err: any) {
    await ctx.answerCbQuery(`Ошибка: ${err.message}`);
  }
});

// Обновить подписку (повторно показать информацию)
bot.action(/^sub_refresh_(\d+)$/, async (ctx) => {
  const subId = parseInt(ctx.match[1]);
  const sub = queries.getSubscriptionById.get(subId) as any;
  
  if (!sub) {
    await ctx.answerCbQuery('Подписка не найдена');
    return;
  }

  try {
    const proxies = await SubscriptionManager.getSubscriptionProxies(subId);
    const info = SubscriptionFormatter.formatSubscriptionInfo(sub, proxies.length);
    const proxyList = SubscriptionFormatter.formatProxiesForTelegram(proxies);
    const links = SubscriptionManager.generateSubscriptionLinks(proxies);

    let text = `${info}\n\n`;
    text += `<b>Прокси:</b>\n${escapeHtml(proxyList)}\n\n`;
    text += `<b>Готовые ссылки:</b>\n`;
    
    for (const link of links) {
      text += `\`${link}\`\n`;
    }

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('📥 JSON для импорта', `sub_export_${subId}`),
        Markup.button.callback('🔄 Обновить', `sub_refresh_${subId}`)
      ],
      [
        Markup.button.callback(
          sub.is_active ? '⏸ Деактивировать' : '▶️ Активировать',
          `sub_toggle_${subId}`
        ),
        Markup.button.callback('🗑 Удалить', `sub_delete_${subId}`)
      ]
    ]);

    await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    await ctx.answerCbQuery('Обновлено!');

  } catch (err: any) {
    await ctx.answerCbQuery(`Ошибка: ${err.message}`);
  }
});

// Переключить статус подписки
bot.action(/^sub_toggle_(\d+)$/, async (ctx) => {
  const subId = parseInt(ctx.match[1]);

  try {
    await SubscriptionManager.toggleSubscription(subId);
    await ctx.answerCbQuery('Статус изменён!');
    
    // Обновляем сообщение
    const sub = queries.getSubscriptionById.get(subId) as any;
    
    if (sub) {
      const proxies = await SubscriptionManager.getSubscriptionProxies(subId);
      const info = SubscriptionFormatter.formatSubscriptionInfo(sub, proxies.length);
      const proxyList = SubscriptionFormatter.formatProxiesForTelegram(proxies);
      const links = SubscriptionManager.generateSubscriptionLinks(proxies);

      let text = `${info}\n\n`;
      text += `<b>Прокси:</b>\n${escapeHtml(proxyList)}\n\n`;
      text += `<b>Готовые ссылки:</b>\n`;
      
      for (const link of links) {
        text += `<code>${escapeHtml(link)}</code>\n`;
      }

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('📥 JSON для импорта', `sub_export_${subId}`),
          Markup.button.callback('🔄 Обновить', `sub_refresh_${subId}`)
        ],
        [
          Markup.button.callback(
            sub.is_active ? '⏸ Деактивировать' : '▶️ Активировать',
            `sub_toggle_${subId}`
          ),
          Markup.button.callback('🗑 Удалить', `sub_delete_${subId}`)
        ]
      ]);

      await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    }

  } catch (err: any) {
    await ctx.answerCbQuery(`Ошибка: ${err.message}`);
  }
});

// Удалить подписку
bot.action(/^sub_delete_(\d+)$/, async (ctx) => {
  const subId = parseInt(ctx.match[1]);
  const sub = queries.getSubscriptionById.get(subId) as any;
  
  if (!sub) {
    await ctx.answerCbQuery('Подписка не найдена');
    return;
  }

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Да, удалить', `sub_delete_confirm_${subId}`),
      Markup.button.callback('❌ Отмена', 'cancel')
    ]
  ]);

  await ctx.editMessageText(
    `⚠️ <b>Удаление подписки</b>\n\n` +
    `Название: ${sub.name}\n\n` +
    `Вы уверены? Это действие нельзя отменить.`,
    { parse_mode: 'HTML', ...keyboard }
  );

  await ctx.answerCbQuery();
});

// Подтверждение удаления
bot.action(/^sub_delete_confirm_(\d+)$/, async (ctx) => {
  const subId = parseInt(ctx.match[1]);

  try {
    await SubscriptionManager.deleteSubscription(subId);
    
    await ctx.editMessageText(
      '✅ Подписка успешно удалена',
      { parse_mode: 'HTML' }
    );
    
    await ctx.answerCbQuery('Удалено!');

  } catch (err: any) {
    await ctx.answerCbQuery(`Ошибка: ${err.message}`);
  }
});

// Меню пользователей MTProto
bot.action('menu_users', async (ctx) => {
  try {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔍 Поиск по секрету/ID/UUID', 'user_search')],
      [Markup.button.callback('📊 Статистика пользователей', 'user_stats')],
      [Markup.button.callback('🔙 Главное меню', 'menu_main')],
    ]);

    await ctx.editMessageText(
      '👤 <b>Пользователи MTProto</b>\n\nВыберите действие:',
      { parse_mode: 'HTML', ...keyboard }
    );
    await ctx.answerCbQuery();
  } catch (error) {
    logger.error('Ошибка в menu_users:', error);
    await ctx.answerCbQuery('Ошибка при открытии меню пользователей', { show_alert: true });
  }
});

// Поиск пользователя
bot.action('user_search', async (ctx) => {
  try {
    await ctx.editMessageText(
      '🔍 <b>Поиск пользователя</b>\n\nОтправьте секрет, Telegram ID или UUID пользователя для поиска.',
      { parse_mode: 'HTML' }
    );
    await ctx.answerCbQuery();
    // Устанавливаем состояние ожидания ввода
    // TODO: Реализовать обработку текстового ввода для поиска
  } catch (error) {
    logger.error('Ошибка в user_search:', error);
    await ctx.answerCbQuery('Ошибка при открытии поиска', { show_alert: true });
  }
});

// Статистика пользователей
bot.action('user_stats', async (ctx) => {
  try {
    const activeUsers = queries.getActiveRemnawaveBindings?.all?.() as any[] || [];
    const totalSecrets = queries.getAllUserMtprotoSecretsAll?.all?.() as any[] || [];
    const activeSecrets = totalSecrets.filter(s => s.is_active === 1);
    const allSubs = queries.getAllActiveUserSubscriptions?.all?.() as any[] || [];

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Обновить', 'user_stats')],
      [Markup.button.callback('🔙 К пользователям', 'menu_users')],
    ]);

    let text = '📊 <b>Статистика пользователей</b>\n\n';
    text += `<b>Привязки Remnawave:</b>\n`;
    text += `Активных: ${activeUsers.length}\n\n`;
    text += `<b>MTProto секреты:</b>\n`;
    text += `Всего: ${totalSecrets.length}\n`;
    text += `Активных: ${activeSecrets.length}\n\n`;
    text += `<b>Подписки:</b>\n`;
    text += `Активных: ${allSubs.length}`;

    await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    await ctx.answerCbQuery();
  } catch (error) {
    logger.error('Ошибка в user_stats:', error);
    await ctx.answerCbQuery('Ошибка при получении статистики пользователей', { show_alert: true });
  }
});

// Заказы
bot.action('sales_orders', async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('Доступно только админам');
      return;
    }

    const orders = queries.getAllOrders?.all?.() as any[] || [];
    const recentOrders = orders.slice(0, 10);

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Обновить', 'sales_orders')],
      [Markup.button.callback('🔙 К продажам', 'menu_sales')],
    ]);

    let text = '📦 <b>Заказы</b>\n\n';
    if (recentOrders.length === 0) {
      text += 'Заказов пока нет.';
    } else {
      text += `Всего заказов: ${orders.length}\n\n`;
      text += '<b>Последние заказы:</b>\n';
      for (const order of recentOrders) {
        const status = order.status === 'completed' ? '✅' : order.status === 'pending' ? '⏳' : '❌';
        text += `${status} Заказ #${order.id} — ${order.amount} ₽ (${order.status})\n`;
      }
    }

    await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    await ctx.answerCbQuery();
  } catch (error) {
    logger.error('Ошибка в sales_orders:', error);
    await ctx.answerCbQuery('Ошибка при получении заказов', { show_alert: true });
  }
});

// Меню продаж
bot.action('menu_sales', async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('Доступно только админам');
      return;
    }

    const products = queries.getAllProducts?.all?.() as any[] || [];
    const payStats = queries.getPaymentStats?.get?.() as any;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('📋 Тарифы', 'sales_products')],
      [Markup.button.callback('💰 Статистика продаж', 'sales_stats')],
      [Markup.button.callback('📦 Заказы', 'sales_orders')],
      [Markup.button.callback('🔙 Главное меню', 'menu_main')],
    ]);

    let text = '💰 <b>Продажи MTProxy</b>\n\n';
    text += '<b>Статистика:</b>\n';
    text += `Всего платежей: ${payStats?.total_payments || 0}\n`;
    text += `Всего выручка: ${payStats?.total_amount || 0} ₽\n`;
    text += `Сегодня: ${payStats?.today_payments || 0} платежей (${payStats?.today_amount || 0} ₽)\n\n`;
    text += `Активных тарифов: ${products.length}`;

    await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    await ctx.answerCbQuery();
  } catch (error) {
    logger.error('Ошибка в menu_sales:', error);
    await ctx.answerCbQuery('Ошибка при открытии меню продаж', { show_alert: true });
  }
});

// Команда тарифов для пользователей
bot.command('tariffs', handleTariffs);
bot.action('cmd_tariffs', async (ctx) => {
  await ctx.answerCbQuery();
  await handleTariffs(ctx);
});

async function handleTariffs(ctx: any) {
  const products = queries.getAllProducts.all() as any[];
  
  if (products.length === 0) {
    // Инициализируем дефолтные тарифы если их нет
    for (const product of DEFAULT_PRODUCTS) {
      queries.insertProduct.run({
        name: product.name,
        emoji: product.emoji,
        price: product.price,
        days: product.days,
        minutes: product.minutes || null,
        max_connections: product.maxConnections,
        description: product.description,
        is_trial: product.isTrial ? 1 : 0,
        node_count: product.nodeCount,
      });
    }
    // Повторно получаем
    const updatedProducts = queries.getAllProducts.all() as any[];
    return showTariffs(ctx, updatedProducts);
  }
  
  return showTariffs(ctx, products);
}

function showTariffs(ctx: any, products: any[]) {
  const buttons = products.map(product => {
    const price = product.price === 0 ? 'БЕСПЛАТНО' : `${product.price} ₽`;
    const nodes = product.node_count > 1 ? ` (${product.node_count} ноды)` : '';
    return [Markup.button.callback(
      `${product.emoji} ${product.name} — ${price}${nodes}`,
      `buy_${product.id}`
    )];
  });

  const keyboard = Markup.inlineKeyboard([
    ...buttons,
    [Markup.button.callback('📊 Мой статус', 'cmd_status')],
  ]);

  let text = '💰 <b>Тарифы MTProxy</b>\n\n';
  text += formatProductList(products.map(p => ({
    name: p.name,
    emoji: p.emoji,
    price: p.price,
    days: p.days,
    minutes: p.minutes,
    maxConnections: p.max_connections,
    description: p.description,
    isTrial: p.is_trial === 1,
    nodeCount: p.node_count,
  })));
  text += '\n\nОплата банковской картой через ЮMoney.';

  if (ctx.callbackQuery) {
    return ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
  } else {
    return ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  }
}

// Команда статуса для пользователей
bot.command('status', handleStatus);
bot.action('cmd_status', async (ctx) => {
  await ctx.answerCbQuery();
  await handleStatus(ctx);
});

async function handleStatus(ctx: any) {
  const userId = ctx.from.id;
  const userSubs = SalesManager.getUserSubscriptions(userId);
  const remnawaveBindings = queries.getRemnawaveBindingsByTelegramId.all(userId) as any[];
  const secrets = queries.getUserMtprotoSecretsByTelegramId.all(userId) as any[];

  if (userSubs.length === 0 && remnawaveBindings.length === 0) {
    const text = '❌ У вас нет активной подписки.\n\n💰 /tariffs — выбрать тариф';
    if (ctx.callbackQuery) {
      return ctx.editMessageText(text, { parse_mode: 'HTML' });
    } else {
      return ctx.reply(text, { parse_mode: 'HTML' });
    }
  }

  let text = '📊 <b>Ваш статус</b>\n\n';

  if (userSubs.length > 0) {
    text += `<b>Купленные подписки:</b>\n`;
    for (const sub of userSubs) {
      const product = queries.getProductById.get(sub.product_id) as any;
      const expiresAt = new Date(sub.expires_at);
      const now = new Date();
      const daysLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      text += `${product?.emoji || '📦'} ${product?.name || 'N/A'}\n`;
      text += `  До: ${expiresAt.toLocaleDateString('ru-RU')} (${daysLeft} дн.)\n\n`;
    }
  }

  if (remnawaveBindings.length > 0) {
    text += `<b>Remnawave подписки:</b>\n`;
    for (const binding of remnawaveBindings) {
      text += `✅ ${binding.remnawave_subscription_id}\n`;
      text += `  Статус: ${binding.status}\n\n`;
    }
  }

  if (secrets.length > 0) {
    text += `<b>Активных MTProto секретов:</b> ${secrets.length}\n`;
    text += `🔗 /link — получить ссылки`;
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💰 Тарифы', 'cmd_tariffs')],
    [Markup.button.callback('🔗 Мои ссылки', 'cmd_link')],
  ]);

  if (ctx.callbackQuery) {
    return ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
  } else {
    return ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
  }
}

// Команда ссылок для пользователей
bot.command('link', handleLink);
bot.action('cmd_link', async (ctx) => {
  await ctx.answerCbQuery();
  await handleLink(ctx);
});

async function handleLink(ctx: any) {
  const userId = ctx.from.id;
  const secrets = queries.getUserMtprotoSecretsByTelegramId.all(userId) as any[];

  if (secrets.length === 0) {
    const text = '❌ Нет активных MTProto секретов.\n\n💰 /tariffs — выбрать тариф';
    if (ctx.callbackQuery) {
      return ctx.editMessageText(text, { parse_mode: 'HTML' });
    } else {
      return ctx.reply(text, { parse_mode: 'HTML' });
    }
  }

  let text = '🔗 <b>Ваши MTProto ссылки:</b>\n\n';
  for (const secret of secrets) {
    const node = queries.getNodeById.get(secret.node_id) as any;
    if (node) {
      const link = ProxyLinkGenerator.generateMtProtoLink(
        node.domain,
        node.mtproto_port,
        secret.secret,
        secret.is_fake_tls === 1
      );
      text += `<b>Нода ${escapeHtml(node.name)}:</b>\n<code>${escapeHtml(link)}</code>\n\n`;
    }
  }
  text += `⚠️ Ссылки только для вас! Не передавайте их другим.`;

  if (ctx.callbackQuery) {
    return ctx.editMessageText(text, { parse_mode: 'HTML' });
  } else {
    return ctx.reply(text, { parse_mode: 'HTML' });
  }
}

// Меню создания MTProto
bot.action('menu_create_mtproto', async (ctx) => {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🔗 По ссылке Remnawave', 'create_by_link')],
    [Markup.button.callback('🆔 По Telegram ID', 'create_by_tgid')],
    [Markup.button.callback('👤 По Username', 'create_by_username')],
    [Markup.button.callback('🆔 По UUID', 'create_by_uuid')],
    [Markup.button.callback('🔙 Главное меню', 'menu_main')],
  ]);

  await ctx.editMessageText(
    '➕ <b>Создание MTProto</b>\n\nВыберите способ:\n\n' +
    '• По ссылке Remnawave — вставьте ссылку на подписку\n' +
    '• По Telegram ID — введите Telegram ID пользователя\n' +
    '• По Username — введите @username\n' +
    '• По UUID — введите UUID пользователя',
    { parse_mode: 'HTML', ...keyboard }
  );
  await ctx.answerCbQuery();
});

// Создание MTProto по ссылке
bot.action('create_by_link', async (ctx) => {
  await ctx.editMessageText(
    '🔗 <b>Создание MTProto по ссылке Remnawave</b>\n\n' +
    'Отправьте ссылку на подписку Remnawave.\n\n' +
    'Пример: https://panel.example.com/subscription/abc123',
    { parse_mode: 'HTML' }
  );
  await ctx.answerCbQuery();
  // Сохраняем состояние для следующего сообщения
  (ctx as any).session = { action: 'create_mtproto_by_link' };
});

// Создание MTProto по Telegram ID
bot.action('create_by_tgid', async (ctx) => {
  await ctx.editMessageText(
    '🆔 <b>Создание MTProto по Telegram ID</b>\n\n' +
    'Отправьте Telegram ID пользователя.\n\n' +
    'Пример: 123456789',
    { parse_mode: 'HTML' }
  );
  await ctx.answerCbQuery();
  (ctx as any).session = { action: 'create_mtproto_by_tgid' };
});

// Создание MTProto по Username
bot.action('create_by_username', async (ctx) => {
  await ctx.editMessageText(
    '👤 *Создание MTProto по Username*\n\n' +
    'Отправьте username пользователя (без @).\n\n' +
    'Пример: username',
    { parse_mode: 'HTML' }
  );
  await ctx.answerCbQuery();
  (ctx as any).session = { action: 'create_mtproto_by_username' };
});

// Создание MTProto по UUID
bot.action('create_by_uuid', async (ctx) => {
  await ctx.editMessageText(
    '🆔 *Создание MTProto по UUID*\n\n' +
    'Отправьте UUID пользователя из Remnawave.\n\n' +
    'Пример: abc-def-ghi',
    { parse_mode: 'HTML' }
  );
  await ctx.answerCbQuery();
  (ctx as any).session = { action: 'create_mtproto_by_uuid' };
});

// Обработка текстовых сообщений для создания MTProto
bot.on(message('text'), async (ctx) => {
  const session = (ctx as any).session;
  if (!session || !session.action) return;

  const text = ctx.message.text.trim();

  try {
    if (session.action === 'create_mtproto_by_link') {
      // Извлекаем subscription ID из ссылки или используем как есть
      const subscriptionId = text.includes('/') ? text.split('/').pop() : text;
      
      await ctx.reply('⏳ Обработка...');
      
      // Ищем подписку в базе
      const binding = queries.getRemnawaveBindingBySubscriptionId.get(subscriptionId) as any;
      if (!binding) {
        return ctx.reply('❌ Подписка не найдена в базе. Сначала создайте привязку через API или выберите локальную подписку.');
      }

      const sub = queries.getSubscriptionById.get(binding.local_subscription_id) as any;
      if (!sub) {
        return ctx.reply('❌ Локальная подписка не найдена.');
      }

      if (!binding.telegram_id) {
        return ctx.reply('❌ У этой подписки нет привязанного Telegram ID. Используйте создание по Telegram ID.');
      }

      const nodeIds = JSON.parse(sub.node_ids || '[]') as number[];
      const userLinks = await MtprotoUserManager.ensureUserSecretsOnNodes({
        telegramId: binding.telegram_id,
        nodeIds,
        isFakeTls: true,
      });

      let resultText = '✅ *MTProto создан!*\n\n';
      resultText += `*Telegram ID:* ${binding.telegram_id}\n`;
      resultText += `*Подписка:* ${binding.remnawave_subscription_id}\n`;
      resultText += `*Секретов:* ${userLinks.length}\n\n`;
      resultText += '*Ссылки:*\n';
      for (const link of userLinks) {
        resultText += `\`${link.link}\`\n`;
      }

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('👤 Информация о пользователе', `user_info_${binding.telegram_id}`)],
        [Markup.button.callback('🔙 Главное меню', 'menu_main')],
      ]);

      await ctx.reply(resultText, { parse_mode: 'HTML', ...keyboard });
      (ctx as any).session = null;

    } else if (session.action === 'create_mtproto_by_tgid') {
      const telegramId = parseInt(text, 10);
      if (isNaN(telegramId)) {
        return ctx.reply('❌ Неверный формат Telegram ID. Отправьте число.');
      }

      await ctx.reply('⏳ Обработка...');

      const backend = getBackendClientFromEnv();
      if (!backend) {
        return ctx.reply('❌ Backend не настроен. Укажите BACKEND_BASE_URL и BACKEND_TOKEN в .env');
      }
      const backendUser = await backend.getUserByTelegramId(telegramId);
      const userUuid = backendUser.uuid;
      
      if (!userUuid) {
        return ctx.reply('❌ Пользователь не найден в backend.');
      }

      const acc = await backend.getAccessibleNodes(userUuid);
      const nodes = (acc?.nodes || acc?.data?.nodes || acc?.accessibleNodes || []) as any[];
      const hasAccess = Array.isArray(nodes) && nodes.length > 0;

      if (!hasAccess) {
        return ctx.reply('❌ У пользователя нет активных подписок в Remnawave.');
      }

      // Ищем активную привязку
      const bindings = queries.getRemnawaveBindingsByTelegramId.all(telegramId) as any[];
      const activeBinding = bindings.find(b => b.status === 'active');

      if (!activeBinding) {
        return ctx.reply('❌ Нет активной привязки подписки. Сначала создайте привязку через API.');
      }

      const sub = queries.getSubscriptionById.get(activeBinding.local_subscription_id) as any;
      if (!sub) {
        return ctx.reply('❌ Локальная подписка не найдена.');
      }

      const nodeIds = JSON.parse(sub.node_ids || '[]') as number[];
      const userLinks = await MtprotoUserManager.ensureUserSecretsOnNodes({
        telegramId,
        nodeIds,
        isFakeTls: true,
      });

      let resultText = '✅ *MTProto создан!*\n\n';
      resultText += `*Telegram ID:* ${telegramId}\n`;
      resultText += `*UUID:* ${userUuid}\n`;
      resultText += `*Подписка:* ${activeBinding.remnawave_subscription_id}\n`;
      resultText += `*Секретов:* ${userLinks.length}\n\n`;
      resultText += '*Ссылки:*\n';
      for (const link of userLinks) {
        resultText += `\`${link.link}\`\n`;
      }

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('👤 Информация о пользователе', `user_info_${telegramId}`)],
        [Markup.button.callback('🔙 Главное меню', 'menu_main')],
      ]);

      await ctx.reply(resultText, { parse_mode: 'HTML', ...keyboard });
      (ctx as any).session = null;

    } else if (session.action === 'create_mtproto_by_username') {
      const username = text.replace('@', '');
      await ctx.reply('⏳ Обработка...');

      const backend = getBackendClientFromEnv();
      if (!backend) {
        return ctx.reply('❌ Backend не настроен. Укажите BACKEND_BASE_URL и BACKEND_TOKEN в .env');
      }
      const backendUser = await backend.getUserByUsername(username);
      const userUuid = backendUser.uuid;
      
      if (!userUuid) {
        return ctx.reply('❌ Пользователь не найден в backend.');
      }

      const telegramId = backendUser.telegramId;
      if (!telegramId) {
        return ctx.reply('❌ У пользователя нет привязанного Telegram ID.');
      }

      const acc = await backend.getAccessibleNodes(userUuid);
      const nodes = (acc?.nodes || acc?.data?.nodes || acc?.accessibleNodes || []) as any[];
      const hasAccess = Array.isArray(nodes) && nodes.length > 0;

      if (!hasAccess) {
        return ctx.reply('❌ У пользователя нет активных подписок в Remnawave.');
      }

      const bindings = queries.getRemnawaveBindingsByTelegramId.all(telegramId) as any[];
      const activeBinding = bindings.find(b => b.status === 'active');

      if (!activeBinding) {
        return ctx.reply('❌ Нет активной привязки подписки. Сначала создайте привязку через API.');
      }

      const sub = queries.getSubscriptionById.get(activeBinding.local_subscription_id) as any;
      if (!sub) {
        return ctx.reply('❌ Локальная подписка не найдена.');
      }

      const nodeIds = JSON.parse(sub.node_ids || '[]') as number[];
      const userLinks = await MtprotoUserManager.ensureUserSecretsOnNodes({
        telegramId,
        nodeIds,
        isFakeTls: true,
      });

      let resultText = '✅ *MTProto создан!*\n\n';
      resultText += `*Username:* @${username}\n`;
      resultText += `*Telegram ID:* ${telegramId}\n`;
      resultText += `*UUID:* ${userUuid}\n`;
      resultText += `*Секретов:* ${userLinks.length}\n\n`;
      resultText += '*Ссылки:*\n';
      for (const link of userLinks) {
        resultText += `\`${link.link}\`\n`;
      }

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('👤 Информация о пользователе', `user_info_${telegramId}`)],
        [Markup.button.callback('🔙 Главное меню', 'menu_main')],
      ]);

      await ctx.reply(resultText, { parse_mode: 'HTML', ...keyboard });
      (ctx as any).session = null;

    } else if (session.action === 'create_mtproto_by_uuid') {
      await ctx.reply('⏳ Обработка...');

      const backend = getBackendClientFromEnv();
      if (!backend) {
        return ctx.reply('❌ Backend не настроен. Укажите BACKEND_BASE_URL и BACKEND_TOKEN в .env');
      }
      const backendUser = await backend.getUserByShortUuid(text);
      const userUuid = backendUser.uuid || text;
      
      const acc = await backend.getAccessibleNodes(userUuid);
      const nodes = (acc?.nodes || acc?.data?.nodes || acc?.accessibleNodes || []) as any[];
      const hasAccess = Array.isArray(nodes) && nodes.length > 0;

      if (!hasAccess) {
        return ctx.reply('❌ У пользователя нет активных подписок в Remnawave.');
      }

      const telegramId = backendUser.telegramId;
      if (!telegramId) {
        return ctx.reply('❌ У пользователя нет привязанного Telegram ID. Используйте создание по Telegram ID.');
      }

      const bindings = queries.getRemnawaveBindingsByTelegramId.all(telegramId) as any[];
      const activeBinding = bindings.find(b => b.status === 'active');

      if (!activeBinding) {
        return ctx.reply('❌ Нет активной привязки подписки. Сначала создайте привязку через API.');
      }

      const sub = queries.getSubscriptionById.get(activeBinding.local_subscription_id) as any;
      if (!sub) {
        return ctx.reply('❌ Локальная подписка не найдена.');
      }

      const nodeIds = JSON.parse(sub.node_ids || '[]') as number[];
      const userLinks = await MtprotoUserManager.ensureUserSecretsOnNodes({
        telegramId,
        nodeIds,
        isFakeTls: true,
      });

      let resultText = '✅ *MTProto создан!*\n\n';
      resultText += `*UUID:* ${userUuid}\n`;
      resultText += `*Telegram ID:* ${telegramId}\n`;
      resultText += `*Секретов:* ${userLinks.length}\n\n`;
      resultText += '*Ссылки:*\n';
      for (const link of userLinks) {
        resultText += `\`${link.link}\`\n`;
      }

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('👤 Информация о пользователе', `user_info_${telegramId}`)],
        [Markup.button.callback('🔙 Главное меню', 'menu_main')],
      ]);

      await ctx.reply(resultText, { parse_mode: 'HTML', ...keyboard });
      (ctx as any).session = null;
    }
  } catch (err: any) {
    await ctx.reply(`❌ Ошибка: ${err.message}`);
    (ctx as any).session = null;
  }
});

// Меню продаж для админа
bot.action('sales_products', async (ctx) => {
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('Доступно только админам');
      return;
    }

    const products = queries.getAllProducts?.all?.() as any[] || [];
    
    const buttons = products.map(product => {
      const status = product.is_active ? '🟢' : '🔴';
      return [Markup.button.callback(
        `${status} ${product.emoji} ${product.name} — ${product.price} ₽`,
        `product_info_${product.id}`
      )];
    });

    const keyboard = Markup.inlineKeyboard([
      ...buttons,
      [Markup.button.callback('➕ Добавить тариф', 'product_add')],
      [Markup.button.callback('🔙 К продажам', 'menu_sales')],
    ]);

    let text = '📋 <b>Тарифы</b>\n\n';
    for (const product of products) {
      const status = product.is_active ? '🟢' : '🔴';
      text += `${status} <b>${product.emoji} ${product.name}</b>\n`;
      text += `   Цена: ${product.price} ₽ | Дни: ${product.days || product.minutes + ' мин'}\n`;
      text += `   Нод: ${product.node_count}\n\n`;
    }

    await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    await ctx.answerCbQuery();
  } catch (error) {
    logger.error('Ошибка в sales_products:', error);
    await ctx.answerCbQuery('Ошибка при получении тарифов', { show_alert: true });
  }
});

bot.action('sales_stats', async (ctx) => {
  // #region agent log
  fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bot.ts:2232',message:'sales_stats action called',data:{userId:ctx.from?.id},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  try {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCbQuery('Доступно только админам');
      return;
    }

    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bot.ts:2239',message:'Checking queries before execution',data:{hasGetPaymentStats:!!queries.getPaymentStats,hasGetAllActiveUserSubscriptions:!!queries.getAllActiveUserSubscriptions,hasGetAllOrders:!!queries.getAllOrders},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    const payStats = queries.getPaymentStats?.get?.() as any;
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bot.ts:2242',message:'getPaymentStats executed',data:{payStats:payStats ? 'exists' : 'null'},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    const activeSubs = queries.getAllActiveUserSubscriptions?.all?.() as any[] || [];
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bot.ts:2243',message:'getAllActiveUserSubscriptions executed',data:{activeSubsCount:activeSubs?.length || 0},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    const totalOrders = queries.getAllOrders?.all?.() as any[] || [];
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bot.ts:2244',message:'getAllOrders executed',data:{totalOrdersCount:totalOrders?.length || 0},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Обновить', 'sales_stats')],
      [Markup.button.callback('🔙 К продажам', 'menu_sales')],
    ]);

    let text = '💰 <b>Статистика продаж</b>\n\n';
    text += '<b>Платежи:</b>\n';
    text += `Всего: ${payStats?.total_payments || 0} (${payStats?.total_amount || 0} ₽)\n`;
    text += `Сегодня: ${payStats?.today_payments || 0} (${payStats?.today_amount || 0} ₽)\n\n`;
    text += '<b>Подписки:</b>\n';
    text += `Активных: ${activeSubs.length}\n`;
    text += `Всего заказов: ${totalOrders.length || 0}`;

    await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    await ctx.answerCbQuery();
  } catch (error: any) {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bot.ts:2258',message:'sales_stats error',data:{error:error?.message,stack:error?.stack,name:error?.name},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    logger.error('Ошибка в sales_stats:', error);
    await ctx.answerCbQuery('Ошибка при получении статистики', { show_alert: true });
  }
});

// Меню статистики
bot.action('menu_stats', async (ctx) => {
  try {
    const nodes = queries.getActiveNodes?.all?.() as any[] || [];
    const allStats = queries.getAllNodesLatestStats?.all?.() as any[] || [];
    
    let text = '📊 <b>Общая статистика</b>\n\n';
    text += `Нод активно: ${nodes.length}\n\n`;

    let totalMtprotoConnections = 0;
    let totalSocks5Connections = 0;
    let totalNetworkIn = 0;
    let totalNetworkOut = 0;

    for (const stat of allStats) {
      totalMtprotoConnections += stat.mtproto_connections || 0;
      totalSocks5Connections += stat.socks5_connections || 0;
      totalNetworkIn += stat.network_in_mb || 0;
      totalNetworkOut += stat.network_out_mb || 0;
      
      text += `<b>${stat.node_name}</b>\n`;
      text += `  MTProto: ${stat.mtproto_connections}/${stat.mtproto_max}\n`;
      text += `  SOCKS5: ${stat.socks5_connections}\n`;
      text += `  CPU: ${stat.cpu_usage?.toFixed(1)}% | RAM: ${stat.ram_usage?.toFixed(1)}%\n`;
      text += `  Трафик: ↓${(stat.network_in_mb || 0).toFixed(2)}MB ↑${(stat.network_out_mb || 0).toFixed(2)}MB\n\n`;
    }

    text += `<b>Итого:</b>\n`;
    text += `MTProto подключений: ${totalMtprotoConnections}\n`;
    text += `SOCKS5 подключений: ${totalSocks5Connections}\n`;
    text += `Трафик: ↓${totalNetworkIn.toFixed(2)}MB ↑${totalNetworkOut.toFixed(2)}MB\n`;

    const activeUsers = queries.getActiveRemnawaveBindings?.all?.() as any[] || [];
    const totalSecrets = queries.getAllUserMtprotoSecretsAll?.all?.() as any[] || [];
    const activeSecrets = totalSecrets.filter(s => s.is_active === 1);

    text += `\n<b>Пользователи:</b>\n`;
    text += `Активных привязок: ${activeUsers.length}\n`;
    text += `Активных секретов: ${activeSecrets.length}\n`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Обновить', 'menu_stats')],
      [Markup.button.callback('🔙 Главное меню', 'menu_main')],
    ]);

    await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    await ctx.answerCbQuery();
  } catch (error) {
    logger.error('Ошибка в menu_stats:', error);
    await ctx.answerCbQuery('Ошибка при получении статистики', { show_alert: true });
  }
});

// Меню настроек
bot.action('menu_settings', async (ctx) => {
  try {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🏥 Здоровье нод', 'health_check')],
      [Markup.button.callback('📋 Логи', 'logs_menu')],
      [Markup.button.callback('🔙 Главное меню', 'menu_main')],
    ]);

    await ctx.editMessageText(
      '⚙️ <b>Настройки</b>\n\nВыберите действие:',
      { parse_mode: 'HTML', ...keyboard }
    );
    await ctx.answerCbQuery();
  } catch (error) {
    logger.error('Ошибка в menu_settings:', error);
    await ctx.answerCbQuery('Ошибка при открытии настроек', { show_alert: true });
  }
});

// ═══════════════════════════════════════════════
// CRON: МОНИТОРИНГ
// ═══════════════════════════════════════════════

// Каждые 5 минут — проверка здоровья нод и сбор статистики
cron.schedule('*/5 * * * *', async () => {
  logger.debug('[Cron] Проверка здоровья нод...');
  
  const nodes = queries.getActiveNodes.all() as any[];

  for (const node of nodes) {
    const client = getNodeClient(node.id);
    if (!client) continue;

    try {
      const health = await client.getHealth();
      const stats = await client.getStats();

      // Обновляем статус ноды
      queries.updateNodeStatus.run({
        id: node.id,
        status: health.status === 'healthy' ? 'online' : 'offline',
      });

      // Сохраняем статистику
      queries.insertStats.run({
        node_id: node.id,
        mtproto_connections: stats.mtproto.connections,
        mtproto_max: stats.mtproto.maxConnections,
        socks5_connections: stats.socks5.connections,
        cpu_usage: health.system.cpuUsage,
        ram_usage: health.system.ramUsage,
        network_in_mb: stats.network.inMb,
        network_out_mb: stats.network.outMb,
      });

      logger.debug(`[Cron] Node ${node.name}: ${health.status}`);
    } catch (err: any) {
      logger.error(`[Cron] Error checking node ${node.name}:`, err);
      
      queries.updateNodeStatus.run({
        id: node.id,
        status: 'error',
      });

      queries.insertLog.run({
        node_id: node.id,
        level: 'error',
        message: 'Health check failed',
        details: err.message,
      });
    }
  }
});

// Каждые 30 минут — проверка статусов Remnawave подписок
cron.schedule('*/30 * * * *', async () => {
  logger.info('[Cron] Проверка статусов Remnawave подписок...');
  const activeBindings = queries.getActiveRemnawaveBindings.all() as any[];
  const backend = getBackendClientFromEnv();
  
  if (!backend) {
    logger.warn('[Cron] Backend не настроен, пропускаем проверку статусов Remnawave подписок');
    return;
  }

  // Функция для обеспечения доступа пользователя к MTProto через Remnawave
  async function ensureRemnawaveUserAccess(telegramId: number, userUuid: string): Promise<void> {
    if (!backend) return;
    try {
      const acc = await backend.getAccessibleNodes(userUuid);
      const nodes = (acc?.nodes || acc?.data?.nodes || acc?.accessibleNodes || []) as any[];
      if (nodes.length === 0) return;
      
      // Получаем ID нод из базы данных по их UUID или имени
      const nodeIds: number[] = [];
      for (const node of nodes) {
        const nodeId = node.id || node.nodeId;
        const nodeName = node.name || node.nodeName;
        if (nodeId) {
          // Если есть ID, ищем ноду в базе
          const dbNode = queries.getNodeById.get(nodeId) as any;
          if (dbNode) nodeIds.push(dbNode.id);
        } else if (nodeName) {
          // Если есть имя, ищем по домену или имени
          const dbNode = queries.getNodeByDomain.get(nodeName) as any;
          if (dbNode) nodeIds.push(dbNode.id);
        }
      }
      
      if (nodeIds.length > 0) {
        await MtprotoUserManager.ensureUserSecretsOnNodes({
          telegramId,
          nodeIds,
        });
      }
    } catch (e: any) {
      logger.error(`[ensureRemnawaveUserAccess] Ошибка для пользователя ${telegramId}:`, e);
    }
  }

  for (const binding of activeBindings) {
    try {
      const userUuid = binding.remnawave_user_id;
      if (!userUuid) {
        logger.warn(`[Cron] Binding ${binding.id} не имеет remnawave_user_id, пропускаем.`);
        continue;
      }

      const acc = await backend.getAccessibleNodes(userUuid);
      const nodes = (acc?.nodes || acc?.data?.nodes || acc?.accessibleNodes || []) as any[];
      const hasAccess = Array.isArray(nodes) && nodes.length > 0;

      if (hasAccess && binding.status === 'active') {
        // У пользователя есть доступ - выдаем MTProto если еще не выдано
        if (binding.telegram_id) {
          await ensureRemnawaveUserAccess(binding.telegram_id, userUuid);
        }
      } else if (!hasAccess && binding.status === 'active') {
        // Проверяем, есть ли купленные подписки
        if (binding.telegram_id) {
          const userSubs = SalesManager.getUserSubscriptions(binding.telegram_id);
          if (userSubs.length === 0) {
            // Нет купленных подписок - отключаем MTProto
            logger.info(`[Cron] Пользователь ${binding.telegram_id} (${userUuid}) потерял доступ. Отключаем MTProto.`);
            await MtprotoUserManager.disableUser(binding.telegram_id);
            queries.updateRemnawaveStatus.run({
              status: 'expired',
              remnawave_subscription_id: binding.remnawave_subscription_id,
            });
          } else {
            // Есть купленные подписки - просто помечаем Remnawave как expired, но не отключаем MTProto
            queries.updateRemnawaveStatus.run({
              status: 'expired',
              remnawave_subscription_id: binding.remnawave_subscription_id,
            });
          }
        }
      }
    } catch (err: any) {
      logger.error(`[Cron] Ошибка при проверке подписки ${binding.id}:`, err);
    }
  }
  logger.info('[Cron] Проверка статусов Remnawave подписок завершена.');
});

// Раз в день — очистка старых данных
cron.schedule('0 3 * * *', async () => {
  logger.info('[Cron] Очистка старых данных...');
  queries.cleanOldStats.run();
  queries.cleanOldLogs.run();
  logger.info('[Cron] Очистка завершена');
});

// ═══════════════════════════════════════════════
// ЗАПУСК
// ═══════════════════════════════════════════════

// Обработчик покупки тарифов (buy_1, buy_2, ... — id из БД)
bot.action(/^buy_(\d+)$/, async (ctx: any) => {
  await ctx.answerCbQuery();
  try {
    await ctx.editMessageReplyMarkup(undefined);
  } catch {}

  const userId = ctx.from.id;
  const productId = parseInt(ctx.match[1], 10);

  const dbProduct = queries.getProductById.get(productId) as any;
  if (!dbProduct || !dbProduct.is_active) {
    return ctx.reply('❌ Тариф не найден или неактивен. Обратитесь к администратору.');
  }

  if (dbProduct.is_trial === 1) {
    return handleFreeTrial(ctx, dbProduct);
  }

  if (!YOOMONEY_WALLET) {
    return ctx.reply('❌ Оплата временно недоступна. Напишите администратору.');
  }

  const { url, label } = createYooMoneyPaymentLink({
    userId,
    productId: dbProduct.id,
    amount: dbProduct.price,
  });

  pendingPayments.set(label, {
    userId,
    productId: dbProduct.id,
    createdAt: Date.now(),
    chatId: ctx.chat.id,
  });

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url('💳 Оплатить', url)],
    [Markup.button.callback('✅ Я оплатил', `check_${label}`)],
  ]);

  await ctx.reply(
    `💳 *Оплата: ${dbProduct.emoji} ${dbProduct.name}*\n\n` +
    `Сумма: ${dbProduct.price} ₽\n` +
    `Количество нод: ${dbProduct.node_count}\n\n` +
    `Нажмите кнопку для оплаты картой.\n` +
    `После оплаты бот выдаст ссылки автоматически (до 30 сек).`,
    { parse_mode: 'HTML', ...keyboard }
  );
});

// Обработчик "Я оплатил"
bot.action(/^check_(.+)$/, async (ctx: any) => {
  await ctx.answerCbQuery('Проверяю...');
  const label = ctx.match[1];
  const pending = pendingPayments.get(label);

  if (!pending) {
    return ctx.reply('❌ Платёж не найден или уже обработан.');
  }

  const paid = await checkYooMoneyPayment(label);
  if (paid) {
    const product = queries.getProductById.get(pending.productId) as any;
    const result = await activateAfterPayment({
      userId: pending.userId,
      productId: pending.productId,
      chatId: pending.chatId,
      paymentMethod: 'yoomoney',
      paymentId: label,
      amount: product.price,
    });

    if (result.success && result.links) {
      await ctx.editMessageText(
        `✅ *Оплата принята! Спасибо!*\n\n` +
        `Тариф: ${product.emoji} ${product.name}\n` +
        `Количество нод: ${product.node_count}\n\n` +
        `🔗 *Ваши ссылки:*\n${result.links.map(l => `\`${l}\``).join('\n')}\n\n` +
        `⚠️ Ссылки только для вас!\n` +
        `/link — ссылки, /status — статус`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(`❌ Ошибка: ${result.error || 'Неизвестная ошибка'}`);
    }
  } else {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('✅ Я оплатил', `check_${label}`)],
    ]);
    await ctx.reply(
      '⏳ Оплата пока не поступила.\nПодождите 1-2 минуты или нажмите ещё раз.',
      { ...keyboard }
    );
  }
});

// Обработка бесплатного триала
async function handleFreeTrial(ctx: any, product: any) {
  const userId = ctx.from.id;
  
  // Проверяем, есть ли уже активная подписка
  const userSubs = SalesManager.getUserSubscriptions(userId);
  const remnawaveBindings = queries.getRemnawaveBindingsByTelegramId.all(userId) as any[];
  const hasActive = userSubs.length > 0 || remnawaveBindings.some(b => b.status === 'active');
  
  if (hasActive) {
    return ctx.reply('✅ У вас уже есть активная подписка.\n/status — проверить');
  }

  // Выбираем ноды для триала
  const activeNodes = queries.getActiveNodes.all() as any[];
  if (activeNodes.length === 0) {
    return ctx.reply('❌ Нет доступных нод. Обратитесь к администратору.');
  }

  const nodeIds = activeNodes.slice(0, product.node_count || 1).map(n => n.id);
  
  // Вычисляем дату окончания
  const expiresAt = new Date(Date.now() + (product.minutes || 30) * 60000);

  try {
    await ctx.reply('⏳ Настраиваю прокси...');
    
    // Создаем заказ для триала
    const result = await SalesManager.createOrder({
      telegramId: userId,
      productId: product.id,
      paymentMethod: 'trial',
      paymentId: `trial_${Date.now()}`,
      amount: 0,
    });

    if (result.success && result.links) {
      await ctx.reply(
        `✅ *Пробный доступ активирован!*\n\n` +
        `Длительность: ${product.minutes || 30} минут\n` +
        `Количество нод: ${product.node_count || 1}\n\n` +
        `🔗 *Ваши ссылки:*\n${result.links.map(l => `\`${l}\``).join('\n')}\n\n` +
        `⏰ До: ${expiresAt.toLocaleString('ru-RU')}\n\n` +
        `Понравилось? Продлите через /tariffs`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(`❌ Ошибка: ${result.error || 'Неизвестная ошибка'}`);
    }
  } catch (err: any) {
    await ctx.reply(`❌ Ошибка: ${err.message}`);
  }
}

export function startBot() {
  // Регистрация команд для удобства (все действия доступны через кнопки)
  bot.telegram.setMyCommands([
    { command: 'start', description: 'Главное меню' },
    { command: 'tariffs', description: 'Тарифы и покупка' },
    { command: 'status', description: 'Статус подписки' },
    { command: 'link', description: 'Мои MTProto ссылки' },
  ]).catch(() => {});

  // Команды для админов
  if (ADMIN_IDS.length > 0) {
    bot.telegram.setMyCommands([
      { command: 'start', description: 'Главное меню' },
      { command: 'nodes', description: 'Список нод' },
      { command: 'stats', description: 'Статистика системы' },
      { command: 'health', description: 'Здоровье нод' },
      { command: 'tariffs', description: 'Тарифы' },
      { command: 'status', description: 'Статус подписки' },
      { command: 'link', description: 'Мои ссылки' },
    ], { scope: { type: 'chat', chat_id: ADMIN_IDS[0] } }).catch(() => {});
  }

  // Глобальный обработчик ошибок для callback_query
  bot.catch((err: any, ctx) => {
    // #region agent log
    const callbackData = ctx?.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'bot.ts:2669',message:'bot.catch triggered',data:{error:err?.message,stack:err?.stack,name:err?.name,hasCallbackQuery:!!ctx?.callbackQuery,callbackData},timestamp:Date.now(),hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    logger.error('Ошибка в обработчике бота:', err);
    if (ctx.callbackQuery) {
      ctx.answerCbQuery('Произошла ошибка. Попробуйте позже.', { show_alert: true }).catch(() => {});
    }
  });

  bot.launch({
    dropPendingUpdates: true,
  });

  // Инициализация дефолтных продуктов при первом запуске
  const products = queries.getAllProducts.all() as any[];
  if (products.length === 0) {
    logger.info('[Init] Создание дефолтных тарифов...');
    for (const product of DEFAULT_PRODUCTS) {
      queries.insertProduct.run({
        name: product.name,
        emoji: product.emoji,
        price: product.price,
        days: product.days,
        minutes: product.minutes || null,
        max_connections: product.maxConnections,
        description: product.description,
        is_trial: product.isTrial ? 1 : 0,
        node_count: product.nodeCount,
      });
    }
    logger.info('[Init] Дефолтные тарифы созданы');
  }

  // Запуск поллинга платежей
  startPaymentPolling(bot);

  // HTTP API для интеграции с Remnawave запускается в index.ts

  // Каждую минуту проверяем истекшие подписки продаж
  cron.schedule('*/1 * * * *', async () => {
    const expiredSubs = queries.getExpiredUserSubscriptions.all() as any[];
    if (expiredSubs.length === 0) return;

    for (const sub of expiredSubs) {
      queries.updateUserSubscriptionStatus.run({
        id: sub.id,
        status: 'expired',
      });

      // Проверяем, есть ли другие активные подписки или Remnawave
      const userId = sub.telegram_id;
      const activeSubs = queries.getActiveUserSubscriptions.all(userId) as any[];
      const remnawaveBindings = queries.getRemnawaveBindingsByTelegramId.all(userId) as any[];
      const hasRemnawave = remnawaveBindings.some(b => b.status === 'active');

      // Если нет других активных подписок и нет Remnawave - отключаем MTProto
      if (activeSubs.length === 0 && !hasRemnawave) {
        await MtprotoUserManager.disableUser(userId);
      }

      // Уведомляем пользователя
      try {
        await bot.telegram.sendMessage(
          userId,
          '⏰ Ваша подписка истекла.\n\nПродлите чтобы продолжить пользоваться:\n/tariffs'
        );
      } catch {}
    }

    logger.info(`[Cron] Истекло подписок продаж: ${expiredSubs.length}`);
  });

  // Каждые 30 минут проверяем активные MTProto-доступы и снимаем их при отсутствии подписок
  cron.schedule('*/30 * * * *', async () => {
    try {
      const backend = getBackendClientFromEnv();
      if (!backend) {
        logger.warn('[Cron] Backend не настроен, пропускаем проверку активных MTProto-доступов');
        return;
      }
      
      // Функция для обеспечения доступа пользователя к MTProto через Remnawave
      async function ensureRemnawaveUserAccess(telegramId: number, userUuid: string): Promise<void> {
        if (!backend) return;
        try {
          const acc = await backend.getAccessibleNodes(userUuid);
          const nodes = (acc?.nodes || acc?.data?.nodes || acc?.accessibleNodes || []) as any[];
          if (nodes.length === 0) return;
          
          // Получаем ID нод из базы данных по их UUID или имени
          const nodeIds: number[] = [];
          for (const node of nodes) {
            const nodeId = node.id || node.nodeId;
            const nodeName = node.name || node.nodeName;
            if (nodeId) {
              // Если есть ID, ищем ноду в базе
              const dbNode = queries.getNodeById.get(nodeId) as any;
              if (dbNode) nodeIds.push(dbNode.id);
            } else if (nodeName) {
              // Если есть имя, ищем по домену или имени
              const dbNode = queries.getNodeByDomain.get(nodeName) as any;
              if (dbNode) nodeIds.push(dbNode.id);
            }
          }
          
          if (nodeIds.length > 0) {
            await MtprotoUserManager.ensureUserSecretsOnNodes({
              telegramId,
              nodeIds,
            });
          }
        } catch (e: any) {
          logger.error(`[ensureRemnawaveUserAccess] Ошибка для пользователя ${telegramId}:`, e);
        }
      }
      
      const bindings = (queries.getActiveRemnawaveBindings?.all?.() || []) as any[];
      for (const b of bindings) {
        const telegramId = b.telegram_id as number | null;
        const userUuid = b.remnawave_user_id as string | null;
        if (!telegramId || !userUuid) continue;
        const acc = await backend.getAccessibleNodes(userUuid);
        const nodes = (acc?.nodes || acc?.data?.nodes || acc?.accessibleNodes || []) as any[];
        const hasAccess = Array.isArray(nodes) && nodes.length > 0;
        
        if (hasAccess && b.status === 'active') {
          // У пользователя есть доступ - выдаем MTProto если еще не выдано
          await ensureRemnawaveUserAccess(telegramId, userUuid);
        } else if (!hasAccess && b.status === 'active') {
          // Проверяем, есть ли купленные подписки
          const userSubs = SalesManager.getUserSubscriptions(telegramId);
          if (userSubs.length === 0) {
            // Нет купленных подписок - отключаем MTProto
            await MtprotoUserManager.disableUser(telegramId);
            queries.updateRemnawaveStatus.run({
              status: 'expired',
              remnawave_subscription_id: b.remnawave_subscription_id,
            });
            queries.insertLog.run({
              node_id: null,
              level: 'info',
              message: 'MTProto access revoked (no accessible nodes)',
              details: `tg:${telegramId} backendUser:${userUuid}`,
            });
          }
        }
      }
    } catch (e: any) {
      logger.error('[Cron] 30m access check failed:', e);
    }
  });

  logger.info('🤖 MTProxy Management Bot запущен!');
  logger.info(`👑 Админы: ${ADMIN_IDS.join(', ')}`);

  // Graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}
