import { Telegraf, Markup, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { queries } from './database';
import { NodeApiClient, ProxyLinkGenerator, SecretGenerator } from './node-client';
import { SubscriptionManager, SubscriptionFormatter } from './subscription-manager';
import cron from 'node-cron';
import crypto from 'crypto';
import dotenv from 'dotenv';

// Загрузка переменных окружения из .env файла
dotenv.config();

// ─── Конфиг ───
const BOT_TOKEN = process.env.BOT_TOKEN!;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => parseInt(id.trim())).filter(id => id > 0);

if (!BOT_TOKEN || ADMIN_IDS.length === 0) {
  console.error('❌ BOT_TOKEN и ADMIN_IDS обязательны в .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Хранилище клиентов для нод (кэш)
const nodeClients = new Map<number, NodeApiClient>();

// Хранилище состояний пользователей (для диалогов)
interface UserState {
  action: 'add_node' | 'add_secret' | 'add_socks5' | 'add_secret_domain' | 'add_secret_ip' | null;
  nodeId?: number;
  secret?: string;
  isFakeTls?: boolean;
  data?: any;
}
const userStates = new Map<number, UserState>();

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
 * Экранирование специальных символов для HTML
 */
function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (match) => {
    const escapeMap: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return escapeMap[match];
  });
}

/**
 * Middleware для проверки админа
 */
bot.use(async (ctx, next) => {
  // Для callback query пользователь находится в ctx.callbackQuery.from
  const userId = ctx.from?.id || ctx.callbackQuery?.from?.id;

  if (!userId) {
    console.log('No user found in ctx');
    return;
  }

  if (!isAdmin(userId)) {
    console.log('User not admin:', userId);
    // Для callback query отвечаем через answerCbQuery
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('⛔ У вас нет доступа к этому боту.');
    } else {
      await ctx.reply('⛔ У вас нет доступа к этому боту.');
    }
    return;
  }

  console.log('User is admin, proceeding with update type:', ctx.updateType);
  if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
    console.log('Callback query data:', ctx.callbackQuery.data);
  }
  return next();
});

// ═══════════════════════════════════════════════
// ОСНОВНЫЕ КОМАНДЫ
// ═══════════════════════════════════════════════

bot.start(async (ctx) => {
  await ctx.reply(
    '👋 <b>MTProxy Management Bot</b>\n\n' +
    'Управление прокси-серверами через Telegram.',
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Ноды', callback_data: 'show_nodes' }],
          [{ text: '➕ Добавить ноду', callback_data: 'add_node' }],
          [{ text: '🔗 Управление ссылками', callback_data: 'manage_links' }],
          [{ text: '📊 Статистика', callback_data: 'show_stats' }],
          [{ text: '📖 Справка', callback_data: 'show_help' }]
        ]
      }
    }
  );
});

bot.help(async (ctx) => {
  await ctx.reply(
    '📖 <b>Справка по командам</b>\n\n' +
    '<b>Управление нодами:</b>\n' +
    '/nodes - список всех нод\n' +
    '/add_node - добавить новую ноду\n' +
    '/node &lt;id&gt; - информация о ноде\n' +
    '/remove_node &lt;id&gt; - удалить ноду\n' +
    '/restart_node &lt;id&gt; - перезапустить прокси\n\n' +
    '<b>Получение доступов:</b>\n' +
    '/links &lt;node_id&gt; - получить все ссылки\n' +
    'Используйте кнопки для добавления MTProto и SOCKS5\n\n' +
    '<b>Подписки:</b>\n' +
    '/create_subscription &lt;название&gt; - создать подписку\n' +
    '/subscriptions - список всех подписок\n' +
    '/subscription &lt;id&gt; - детали подписки\n\n' +
    '<b>Мониторинг:</b>\n' +
    '/stats - общая статистика\n' +
    '/health - здоровье всех нод\n' +
    '/logs &lt;node_id&gt; - логи ноды\n\n' +
    '<b>Настройки:</b>\n' +
    '/set_workers &lt;node_id&gt; &lt;count&gt; - воркеры\n' +
    '/update_node &lt;id&gt; - обновить конфиг',
    { parse_mode: 'HTML' }
  );
});

// ═══════════════════════════════════════════════
// ЛОКАЛЬНЫЙ ПРОКСИ
// ═══════════════════════════════════════════════
// УПРАВЛЕНИЕ НОДАМИ
// ═══════════════════════════════════════════════

bot.command('nodes', async (ctx) => {
  const nodes = queries.getAllNodes.all([]) as any[];
  
  if (nodes.length === 0) {
    return ctx.reply('📭 Нет добавленных нод.\n\nИспользуйте /add_node для добавления.');
  }

  let text = '📡 <b>Список нод:</b>\n\n';
  
  for (const node of nodes) {
    const statusEmoji = node.status === 'online' ? '🟢' : 
                       node.status === 'offline' ? '🔴' : '🟡';
    
    text += `${statusEmoji} <b>${node.name}</b>\n`;
    text += `   ID: <code>${node.id}</code>\n`;
    text += `   Домен: <code>${node.domain}</code>\n`;
    text += `   Статус: ${node.status}\n`;
    text += `   Воркеры: ${node.workers}\n`;
    text += `   /node ${node.id}\n\n`;
  }

  await ctx.reply(text, { parse_mode: 'HTML' });
});

bot.command('node', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ');
    const nodeId = parseInt(args[1]);
    
    if (!nodeId || isNaN(nodeId)) {
      await ctx.reply('Использование: /node <id>');
      return;
    }

    const node = queries.getNodeById.get(nodeId) as any;
    if (!node) {
      await ctx.reply('❌ Нода не найдена');
      return;
    }

    const client = getNodeClient(nodeId);
    let healthInfo = '';
    let statsInfo = '';

    try {
      if (client) {
        const health = await client.getHealth();
        const stats = await client.getStats();
        
        const cpuUsage = health.system.cpuUsage.toFixed(1);
        const ramUsage = health.system.ramUsage.toFixed(1);
        const uptimeHours = Math.floor(health.uptime / 3600);
        const uptimeMinutes = Math.floor((health.uptime % 3600) / 60);
        
        healthInfo = `\nСтатус: ${health.status === 'healthy' ? '✅ Здорова' : '⚠️ Проблемы'}\n` +
                     `Uptime: ${uptimeHours}ч ${uptimeMinutes}м\n` +
                     `CPU: ${cpuUsage}%\n` +
                     `RAM: ${ramUsage}%\n`;
        
        const inMb = stats.network.inMb.toFixed(2);
        const outMb = stats.network.outMb.toFixed(2);
        
        statsInfo = `\nMTProto:\n` +
                    `  Подключений: ${stats.mtproto.connections}/${stats.mtproto.maxConnections}\n` +
                    `  Telegram серверов: ${stats.mtproto.activeTargets}/${stats.mtproto.readyTargets}\n` +
                    `SOCKS5:\n` +
                    `  Подключений: ${stats.socks5.connections}\n` +
                    `Трафик:\n` +
                    `  ⬇️ ${inMb} MB\n` +
                    `  ⬆️ ${outMb} MB\n`;
      }
    } catch (err: any) {
      healthInfo = `\n⚠️ Не удалось получить статус: ${err.message}\n`;
    }

    const nodeInfo = 
      `📡 Нода: ${node.name}\n\n` +
      `ID: ${node.id}\n` +
      `Домен: ${node.domain}\n` +
      `IP: ${node.ip}\n` +
      `MTProto порт: ${node.mtproto_port}\n` +
      `SOCKS5 порт: ${node.socks5_port}\n` +
      `Воркеры: ${node.workers}\n` +
      `CPU ядер: ${node.cpu_cores}\n` +
      `RAM: ${node.ram_mb} MB\n` +
      healthInfo +
      statsInfo;

    await ctx.reply(nodeInfo, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔗 Получить ссылки', callback_data: `get_links_${node.id}` }],
          [
            { text: '➕ MTProto', callback_data: `add_secret_${node.id}` },
            { text: '➕ SOCKS5', callback_data: `add_socks5_${node.id}` }
          ],
          [
            { text: '🔄 Перезапустить', callback_data: `restart_node_${node.id}` },
            { text: '📋 Логи', callback_data: `logs_node_${node.id}` }
          ],
          [
            { text: '🗑️ Удалить ноду', callback_data: `confirm_delete_node_${node.id}` },
            { text: '⬅️ Назад', callback_data: 'show_nodes' }
          ]
        ]
      }
    });
  } catch (err: any) {
    await ctx.reply(`❌ Ошибка при получении информации о ноде: ${err.message}`);
  }
});

bot.command('add_node', async (ctx) => {
  // Устанавливаем состояние ожидания данных ноды
  userStates.set(ctx.from.id, { action: 'add_node' });
  
  await ctx.reply(
    '➕ Добавление новой ноды\n\n' +
    'Отправьте данные ноды в формате:\n\n' +
    'name: Node-Moscow\n' +
    'ip: 1.2.3.4\n' +
    'api_key: ваш_api_key_с_сервера\n\n' +
    'Бот настроит прокси автоматически через API!\n\n' +
    'Отправьте /cancel для отмены.'
  );
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

// ─── НОВЫЕ ОБРАБОТЧИКИ КНОПОК ───

bot.action(/^get_links_(\d+)$/, async (ctx: any) => {
  const nodeId = parseInt(ctx.match[1]);
  await ctx.answerCbQuery();

  console.log(`get_links action triggered for node ${nodeId}`);

  const node = queries.getNodeById.get(nodeId) as any;
  if (!node) {
    console.log(`Node ${nodeId} not found`);
    await ctx.answerCbQuery('Нода не найдена');
    return;
  }

  console.log(`Node found: ${node.name}, domain: ${node.domain}, port: ${node.mtproto_port}`);

  const secrets = queries.getNodeSecrets.all(nodeId) as any[];
  const socks5Accounts = queries.getNodeSocks5Accounts.all(nodeId) as any[];

  console.log(`Secrets count: ${secrets.length}, SOCKS5 accounts: ${socks5Accounts.length}`);

  if (secrets.length === 0 && socks5Accounts.length === 0) {
    await ctx.answerCbQuery('Ссылок нет');
    return;
  }

  let text = `🔗 <b>Ссылки для ${node.name}</b>\n\n`;

  // MTProto ссылки
  if (secrets.length > 0) {
    text += `🟣 <b>MTProto:</b>\n`;
    for (const secret of secrets) {
      const type = secret.is_fake_tls ? 'Fake-TLS' : 'Обычный';
      console.log(`Generating link for secret: ${secret.secret}, domain: ${node.domain}, port: ${node.mtproto_port}, fake_tls: ${secret.is_fake_tls}`);
      
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
      
      console.log(`Generated link: ${link}`);
      console.log(`Generated webLink: ${webLink}`);
      
      text += `   ${type}:\n`;
      if (secret.description) text += `   <i>${secret.description}</i>\n`;
      text += `   <code>${link}</code>\n`;
      text += `   <a href="${webLink}">Подключить</a>\n`;
    }
    text += '\n';
  }

  // SOCKS5 аккаунты
  if (socks5Accounts.length > 0) {
    text += `🔵 <b>SOCKS5:</b>\n\n`;
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
      
      text += `   👤 <b>${account.username}</b>\n`;
      if (account.description) text += `   <i>${account.description}</i>\n`;
      text += `   \n🔗 Deep Link:\n   <code>${tgLink}</code>\n\n`;
      text += `   <a href="${tgLink}">🚀 Подключить в 1 клик</a>\n\n`;
      text += `   ───────────────\n\n`;
    }
  }

  await ctx.reply(text, { 
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true }
  });
});

bot.action(/^restart_node_(\d+)$/, async (ctx: any) => {
  const nodeId = parseInt(ctx.match[1]);
  await ctx.answerCbQuery();

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
    await client.rebootNode();
    await ctx.answerCbQuery('Нода перезапущена');
  } catch (error) {
    console.error('Failed to restart node:', error);
    await ctx.answerCbQuery('Ошибка перезапуска');
  }
});

bot.action(/^logs_node_(\d+)$/, async (ctx: any) => {
  const nodeId = parseInt(ctx.match[1]);
  await ctx.answerCbQuery();

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
    const logs = await client.getLogs(50);
    let text = `📋 <b>Логи для ${node.name}</b>\n\n`;
    text += '<b>MTProto:</b>\n<pre>\n' + logs.mtproto + '\n</pre>\n\n';
    text += '<b>SOCKS5:</b>\n<pre>\n' + logs.socks5 + '\n</pre>\n\n';
    text += '<b>Agent:</b>\n<pre>\n' + logs.agent + '\n</pre>';
    await ctx.reply(text, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Failed to get logs:', error);
    await ctx.answerCbQuery('Ошибка получения логов');
  }
});

bot.action(/^confirm_delete_node_(\d+)$/, async (ctx) => {
  const nodeId = parseInt(ctx.match[1]);
  const node = queries.getNodeById.get(nodeId) as any;
  
  if (!node) {
    await ctx.answerCbQuery('Нода не найдена');
    return;
  }

  await ctx.editMessageText(
    `⚠️ <b>Удаление ноды</b>\n\n` +
    `Вы уверены, что хотите удалить ноду "${node.name}"?\n\n` +
    `Это действие нельзя отменить!`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '❌ Да, удалить', callback_data: `delete_node_${nodeId}` }],
          [{ text: '✅ Отмена', callback_data: 'show_nodes' }]
        ]
      }
    }
  );
});

bot.action(/^delete_node_(\d+)$/, async (ctx) => {
  const nodeId = parseInt(ctx.match[1]);
  const node = queries.getNodeById.get(nodeId) as any;
  
  if (!node) {
    await ctx.answerCbQuery('Нода не найдена');
    return;
  }

  // Удаляем все связанные данные
  queries.deleteNode.run(nodeId);
  
  await ctx.answerCbQuery('Нода удалена');
  await ctx.editMessageText(
    `✅ <b>Нода "${node.name}" успешно удалена!</b>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '⬅️ К списку нод', callback_data: 'show_nodes' }]]
      }
    }
  );
});

bot.action(/^add_secret_(\d+)$/, async (ctx) => {
  console.log(`add_secret action triggered with callback: ${(ctx.callbackQuery as any)?.data}`);
  const nodeId = parseInt(ctx.match[1]);
  console.log(`Parsed nodeId: ${nodeId}`);
  await ctx.answerCbQuery();

  const node = queries.getNodeById.get(nodeId) as any;
  if (!node) {
    await ctx.answerCbQuery('Нода не найдена');
    return;
  }

  // Генерируем секрет
  const secret = SecretGenerator.generateMtProtoSecret();

  await ctx.editMessageText(
    `🔐 Добавление MTProto секрета

Нода: ${node.name}
Секрет: ${secret}

Выберите тип подключения:`,
    {
      ...Markup.inlineKeyboard([
        [Markup.button.callback('🌐 Домен', `add_secret_domain_${nodeId}_${secret}`)],
        [Markup.button.callback('📍 IP адрес', `add_secret_ip_${nodeId}_${secret}`)],
        [Markup.button.callback('❌ Отмена', 'cancel')],
      ])
    }
  );
});

bot.action(/^add_socks5_(\d+)$/, async (ctx: any) => {
  const nodeId = parseInt(ctx.match[1]);
  await ctx.answerCbQuery();

  const node = queries.getNodeById.get(nodeId) as any;
  if (!node) {
    await ctx.answerCbQuery('Нода не найдена');
    return;
  }

  // Устанавливаем состояние ожидания SOCKS5 аккаунта
  userStates.set(ctx.from!.id, { action: 'add_socks5', nodeId });

  await ctx.editMessageText(
    `➕ *Добавление SOCKS5 аккаунта для ${node.name}*\n\n` +
    'Отправьте данные аккаунта в формате:\n' +
    '```\n' +
    'username: myuser\n' +
    'password: mypass\n' +
    '```\n\n' +
    'Отправьте /cancel для отмены.',
    {
      
      reply_markup: {
        inline_keyboard: [[{ text: '⬅️ Назад', callback_data: `manage_node_links_${nodeId}` }]]
      }
    }
  );
});

// ─── ОБРАБОТЧИКИ ГЛАВНОГО МЕНЮ ───

bot.action('show_nodes', async (ctx: any) => {
  console.log('show_nodes action triggered');
  await ctx.answerCbQuery();

  const nodes = queries.getAllNodes.all([]) as any[];

  if (nodes.length === 0) {
    return ctx.reply('📭 Нет добавленных нод.\n\nИспользуйте /add_node для добавления.');
  }

  let text = '📡 <b>Список нод:</b>\n\n';

  for (const node of nodes) {
    const statusEmoji = node.status === 'online' ? '🟢' :
                       node.status === 'offline' ? '🔴' : '🟡';

    text += `${statusEmoji} <b>${node.name}</b>\n`;
    text += `   ID: <code>${node.id}</code>\n`;
    text += `   Домен: <code>${node.domain}</code>\n`;
    text += `   Статус: ${node.status}\n`;
    text += `   Воркеры: ${node.workers}\n`;
    text += `   /node ${node.id}\n\n`;
  }

  await ctx.reply(text, { parse_mode: 'HTML' });
});

bot.action('add_node', async (ctx: any) => {
  console.log('add_node action triggered');
  await ctx.answerCbQuery();

  // Устанавливаем состояние ожидания данных ноды
  userStates.set(ctx.from!.id, { action: 'add_node' });

  await ctx.reply(
    '➕ Добавление новой ноды\n\n' +
    'Отправьте данные ноды в формате:\n\n' +
    'name: Node-Moscow\n' +
    'ip: 1.2.3.4\n' +
    'api_key: ваш_api_key_с_сервера\n\n' +
    'Бот настроит прокси автоматически через API!\n\n' +
    'Отправьте /cancel для отмены.'
  );
});

bot.action('show_help', async (ctx: any) => {
  console.log('show_help action triggered');
  await ctx.answerCbQuery();

  await ctx.reply(
    '📖 <b>Справка по командам</b>\n\n' +
    '<b>Управление нодами:</b>\n' +
    '/nodes - список всех нод\n' +
    '/add_node - добавить новую ноду\n' +
    '/node &lt;id&gt; - информация о ноде\n' +
    '/remove_node &lt;id&gt; - удалить ноду\n' +
    '/restart_node &lt;id&gt; - перезапустить прокси\n\n' +
    '<b>Получение доступов:</b>\n' +
    '/links &lt;node_id&gt; - получить все ссылки\n' +
    '/add_secret &lt;node_id&gt; - добавить секрет\n' +
    '/add_socks5 &lt;node_id&gt; - добавить SOCKS5 аккаунт\n\n' +
    '<b>Подписки:</b>\n' +
    '/create_subscription &lt;название&gt; - создать подписку\n' +
    '/subscriptions - список всех подписок\n' +
    '/subscription &lt;id&gt; - детали подписки\n\n' +
    '<b>Мониторинг:</b>\n' +
    '/stats - общая статистика\n' +
    '/health - здоровье всех нод\n' +
    '/logs &lt;node_id&gt; - логи ноды\n\n' +
    '<b>Настройки:</b>\n' +
    '/set_workers &lt;node_id&gt; &lt;count&gt; - воркеры\n' +
    '/update_node &lt;id&gt; - обновить конфиг',
    { parse_mode: 'HTML' }
  );
});

bot.action('back_to_main', async (ctx: any) => {
  console.log('back_to_main action triggered');
  await ctx.answerCbQuery();

  await ctx.reply(
    '👋 *MTProxy Management Bot*\n\n' +
    'Управление прокси-серверами через Telegram.',
    {
      
      reply_markup: {
        inline_keyboard: [
          [{ text: '📋 Ноды', callback_data: 'show_nodes' }],
          [{ text: '➕ Добавить ноду', callback_data: 'add_node' }],
          [{ text: '🔗 Управление ссылками', callback_data: 'manage_links' }],
          [{ text: '📊 Статистика', callback_data: 'show_stats' }],
          [{ text: '📖 Справка', callback_data: 'show_help' }]
        ]
      }
    }
  );
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

  let text = `🔗 *Доступы для ноды "${node.name}"*\n\n`;

  // MTProto секреты
  if (secrets.length > 0) {
    text += '*MTProto:*\n\n';
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
    text += '*SOCKS5:*\n\n';
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
      
      text += `👤 *${account.username}*\n`;
      if (account.description) text += `_${account.description}_\n`;
      text += `\n🔗 Deep Link:\n\`${tgLink}\`\n\n`;
      text += `[🚀 Подключить в 1 клик](${tgLink})\n\n`;
      text += `───────────────\n\n`;
    }
  }

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    link_preview_options: { is_disabled: true }
  });
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

  await ctx.reply(
    `🔐 <b>Добавление MTProto секрета</b>\n\n` +
    `Нода: ${node.name}\n\n` +
    `Выберите тип MTProto:`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔓 Обычный', callback_data: `add_secret_type_normal_${nodeId}` }],
          [{ text: '🔒 Fake-TLS (DD)', callback_data: `add_secret_type_dd_${nodeId}` }],
          [{ text: '❌ Отмена', callback_data: 'cancel' }]
        ]
      }
    }
  );
});

// ─── ВЫБОР ТИПА MTPROTO ───

bot.action(/^add_secret_type_(normal|dd)_(\d+)$/, async (ctx: any) => {
  const isFakeTls = ctx.match[1] === 'dd';
  const nodeId = parseInt(ctx.match[2]);
  await ctx.answerCbQuery();

  const node = queries.getNodeById.get(nodeId) as any;
  if (!node) {
    await ctx.answerCbQuery('Нода не найдена');
    return;
  }

  // Генерируем секрет
  const secret = SecretGenerator.generateMtProtoSecret();
  const typeText = isFakeTls ? 'Fake-TLS (DD)' : 'Обычный';

  await ctx.editMessageText(
    `🔐 <b>Добавление MTProto секрета</b>\n\n` +
    `Нода: ${node.name}\n` +
    `Тип: ${typeText}\n` +
    `Секрет: <code>${secret}</code>\n\n` +
    `Выберите тип подключения:`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🌐 Домен', callback_data: `add_secret_domain_${isFakeTls ? 'dd' : 'normal'}_${nodeId}_${secret}` }],
          [{ text: '🖥️ IP адрес', callback_data: `add_secret_ip_${isFakeTls ? 'dd' : 'normal'}_${nodeId}_${secret}` }],
          [{ text: '⬅️ Назад', callback_data: `add_secret_${nodeId}` }]
        ]
      }
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
    `✅ *Секрет успешно добавлен!*\n\n` +
    `Нода: ${node.name}\n` +
    `Тип: ${isFakeTls ? 'Fake-TLS (dd)' : 'Обычный'}\n\n` +
    `Ссылка:\n\`${link}\``,
   
  );

  queries.insertLog.run({
    node_id: nodeId,
    level: 'info',
    message: 'MTProto secret added',
    details: `Type: ${isFakeTls ? 'Fake-TLS' : 'Normal'}, Admin: ${ctx.from!.id}`,
  });
});

// ─── ВЫБОР ДОМЕНА/IP ДЛЯ MTPROTO ───

bot.action(/^add_secret_domain_(dd|normal)_(\d+)_([a-f0-9]{32})$/, async (ctx: any) => {
  const isFakeTls = ctx.match[1] === 'dd';
  const nodeId = parseInt(ctx.match[2]);
  const secret = ctx.match[3];
  await ctx.answerCbQuery();

  const node = queries.getNodeById.get(nodeId) as any;
  if (!node) {
    await ctx.answerCbQuery('Нода не найдена');
    return;
  }

  // Устанавливаем состояние ожидания домена
  userStates.set(ctx.from!.id, { action: 'add_secret_domain', nodeId, secret, isFakeTls });

  const typeText = isFakeTls ? 'Fake-TLS (DD)' : 'Обычный';

  await ctx.editMessageText(
    `🌐 <b>Выбор домена для MTProto секрета</b>\n\n` +
    `Нода: ${node.name}\n` +
    `Тип: ${typeText}\n` +
    `Секрет: <code>${secret}</code>\n\n` +
    `Отправьте домен (например: example.com):\n\n` +
    `Отправьте /cancel для отмены.`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '⬅️ Назад', callback_data: `add_secret_type_${isFakeTls ? 'dd' : 'normal'}_${nodeId}` }]]
      }
    }
  );
});

bot.action(/^add_secret_ip_(dd|normal)_(\d+)_([a-f0-9]{32})$/, async (ctx: any) => {
  const isFakeTls = ctx.match[1] === 'dd';
  const nodeId = parseInt(ctx.match[2]);
  const secret = ctx.match[3];
  await ctx.answerCbQuery();

  const node = queries.getNodeById.get(nodeId) as any;
  if (!node) {
    await ctx.answerCbQuery('Нода не найдена');
    return;
  }

  // Устанавливаем состояние ожидания IP
  userStates.set(ctx.from!.id, { action: 'add_secret_ip', nodeId, secret, isFakeTls });

  const typeText = isFakeTls ? 'Fake-TLS (DD)' : 'Обычный';

  await ctx.editMessageText(
    `🖥️ <b>Выбор IP адреса для MTProto секрета</b>\n\n` +
    `Нода: ${node.name}\n` +
    `Тип: ${typeText}\n` +
    `Секрет: <code>${secret}</code>\n\n` +
    `Отправьте IP адрес (например: 1.2.3.4):\n\n` +
    `Отправьте /cancel для отмены.`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: '⬅️ Назад', callback_data: `add_secret_type_${isFakeTls ? 'dd' : 'normal'}_${nodeId}` }]]
      }
    }
  );
});

// ─── SOCKS5 ───
// SOCKS5 аккаунты добавляются через кнопку "➕ SOCKS5" в интерфейсе управления ссылками
// (см. bot.action(/^add_socks5_(\d+)$/) и обработчик текста в bot.on(message('text')))

// ═══════════════════════════════════════════════
// МОНИТОРИНГ
// ═══════════════════════════════════════════════

bot.command('stats', async (ctx) => {
  await showStats(ctx);
});

bot.action('show_stats', async (ctx: any) => {
  await ctx.answerCbQuery();
  await showStats(ctx, true);
});

bot.action('refresh_stats', async (ctx: any) => {
  await ctx.answerCbQuery('🔄 Обновление...');
  await showStats(ctx, true);
});

async function showStats(ctx: any, isEdit: boolean = false) {
  const nodes = queries.getActiveNodes.all([]) as any[];
  
  if (nodes.length === 0) {
    const text = '📭 Нет активных нод. Добавьте ноду через /add_node';
    return isEdit ? ctx.editMessageText(text) : ctx.reply(text);
  }

  let text = '📊 <b>Статистика прокси</b>\n';
  text += `⏰ ${new Date().toLocaleString('ru-RU')}\n\n`;

  let totalMtprotoConnections = 0;
  let totalMtprotoMax = 0;
  let totalSocks5Connections = 0;
  let avgCpu = 0;
  let avgRam = 0;
  let totalNetworkIn = 0;
  let totalNetworkOut = 0;
  let onlineNodes = 0;
  let offlineNodes = 0;

  // Собираем статистику по каждой ноде
  for (const node of nodes) {
    const client = getNodeClient(node.id);
    if (!client) continue;

    try {
      const health = await client.getHealth();
      const stats = await client.getStats();

      if (health.status === 'healthy') {
        onlineNodes++;
      } else {
        offlineNodes++;
      }

      totalMtprotoConnections += stats.mtproto.connections || 0;
      totalMtprotoMax += stats.mtproto.maxConnections || 0;
      totalSocks5Connections += stats.socks5.connections || 0;
      avgCpu += health.system.cpuUsage || 0;
      avgRam += health.system.ramUsage || 0;
      totalNetworkIn += stats.network.inMb || 0;
      totalNetworkOut += stats.network.outMb || 0;

      // Статус ноды
      const statusEmoji = health.status === 'healthy' ? '🟢' : '🔴';
      const uptimeHours = Math.floor(health.uptime / 3600);
      const uptimeDays = Math.floor(uptimeHours / 24);
      const uptimeStr = uptimeDays > 0 ? `${uptimeDays}д` : `${uptimeHours}ч`;

      text += `${statusEmoji} <b>${node.name}</b> <code>${uptimeStr}</code>\n`;
      
      // MTProto
      if (health.mtproto.running) {
        const mtprotoPercent = stats.mtproto.maxConnections > 0 
          ? Math.round((stats.mtproto.connections / stats.mtproto.maxConnections) * 100)
          : 0;
        const mtprotoBar = generateProgressBar(mtprotoPercent);
        text += `   🔷 MTProto: ${stats.mtproto.connections}/${stats.mtproto.maxConnections} ${mtprotoBar}\n`;
      } else {
        text += `   🔷 MTProto: <i>не настроен</i>\n`;
      }
      
      // SOCKS5
      if (health.socks5.running) {
        if (stats.socks5.connections > 0) {
          text += `   🔵 SOCKS5: ${stats.socks5.connections} активных\n`;
        } else {
          text += `   🔵 SOCKS5: настроен, нет подключений\n`;
        }
      }
      
      // Система
      const cpuBar = generateProgressBar(Math.round(health.system.cpuUsage));
      const ramBar = generateProgressBar(Math.round(health.system.ramUsage));
      text += `   💻 CPU: ${health.system.cpuUsage.toFixed(1)}% ${cpuBar}\n`;
      text += `   🧠 RAM: ${health.system.ramUsage.toFixed(1)}% ${ramBar}\n`;
      text += `   💾 Disk: ${health.system.diskUsage}%\n`;
      
      // Сеть
      text += `   🌐 ↓${stats.network.inMb.toFixed(1)}MB ↑${stats.network.outMb.toFixed(1)}MB\n\n`;

    } catch (err: any) {
      offlineNodes++;
      text += `🔴 <b>${node.name}</b> - <i>недоступна</i>\n`;
      text += `   ⚠️ ${err.message}\n\n`;
    }
  }

  // Средние значения
  const totalNodes = onlineNodes + offlineNodes;
  if (onlineNodes > 0) {
    avgCpu = avgCpu / onlineNodes;
    avgRam = avgRam / onlineNodes;
  }

  // Итоговая статистика
  text += `━━━━━━━━━━━━━━━\n`;
  text += `📈 <b>Общая статистика:</b>\n\n`;
  text += `🖥 Нод: ${onlineNodes} online / ${offlineNodes} offline из ${totalNodes}\n`;
  text += `👥 Всего подключений:\n`;
  text += `   • MTProto: <b>${totalMtprotoConnections}</b>/${totalMtprotoMax}\n`;
  text += `   • SOCKS5: <b>${totalSocks5Connections}</b>\n`;
  text += `📊 Средняя нагрузка:\n`;
  text += `   • CPU: ${avgCpu.toFixed(1)}%\n`;
  text += `   • RAM: ${avgRam.toFixed(1)}%\n`;
  text += `🌐 Суммарный трафик:\n`;
  text += `   • ↓ ${(totalNetworkIn / 1024).toFixed(2)} GB\n`;
  text += `   • ↑ ${(totalNetworkOut / 1024).toFixed(2)} GB\n`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '🔄 Обновить', callback_data: 'refresh_stats' }],
      [{ text: '⬅️ Назад', callback_data: 'back_to_main' }]
    ]
  };

  try {
    if (isEdit) {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    } else {
      await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    }
  } catch (err) {
    console.error('Error showing stats:', err);
  }
}

// Функция для генерации прогресс-бара
function generateProgressBar(percent: number, length: number = 10): string {
  const filled = Math.round((percent / 100) * length);
  const empty = length - filled;
  
  let bar = '';
  for (let i = 0; i < filled; i++) bar += '█';
  for (let i = 0; i < empty; i++) bar += '░';
  
  return bar;
}

bot.command('health', async (ctx) => {
  const nodes = queries.getActiveNodes.all([]) as any[];
  
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

    text += `<b>${node.name}</b>\n`;
    text += `Status: ${status}\n`;
    if (details) text += `${details}\n`;
    text += `\n`;
  }

  await ctx.reply(text, { parse_mode: 'HTML' });
});

bot.command('refresh_nodes', async (ctx) => {
  await ctx.reply('🔄 Обновляю статус всех нод...');
  
  const nodes = queries.getActiveNodes.all([]) as any[];
  let updated = 0;
  let errors = 0;

  for (const node of nodes) {
    const client = getNodeClient(node.id);
    if (!client) {
      errors++;
      continue;
    }

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

      updated++;
    } catch (err: any) {
      queries.updateNodeStatus.run({
        id: node.id,
        status: 'error',
      });
      errors++;
    }
  }

  await ctx.reply(
    `✅ Обновление завершено!\n\n` +
    `Обновлено: ${updated}\n` +
    `Ошибок: ${errors}\n\n` +
    `Проверьте: /nodes`
  );
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
    let text = `📋 *Логи ноды: ${node.name}*\n\n`;
    
    text += `*MTProxy (последние ${lines} строк):*\n`;
    text += '```\n';
    text += logs.mtproto.substring(Math.max(0, logs.mtproto.length - 1500)); // Последние 1500 символов
    text += '\n```\n\n';
    
    text += `*SOCKS5 (последние ${lines} строк):*\n`;
    text += '```\n';
    text += logs.socks5.substring(Math.max(0, logs.socks5.length - 1500));
    text += '\n```';

    await ctx.reply(text);

  } catch (err: any) {
    await ctx.reply(`❌ Ошибка: ${err.message}`);
  }
});

bot.command('restart_node', async (ctx) => {
  const nodeId = parseInt(ctx.message.text.split(' ')[1]);
  
  if (!nodeId) {
    return ctx.reply('Использование: /restart_node <node_id>');
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
    await ctx.reply('⏳ Перезапуск прокси-сервисов...');
    
    // Перезапускаем MTProxy
    await client.restartMtProto();
    
    // Перезапускаем SOCKS5
    await client.restartSocks5();
    
    await ctx.reply(`✅ Прокси на ноде "${node.name}" успешно перезапущены`);
    
    queries.insertLog.run({
      node_id: nodeId,
      level: 'info',
      message: 'Proxies restarted',
      details: `Admin ID: ${ctx.from.id}`,
    });

  } catch (err: any) {
    await ctx.reply(`❌ Ошибка при перезапуске: ${err.message}`);
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
      `✅ *Воркеры обновлены!*\n\n` +
      `Нода: ${node.name}\n` +
      `Воркеров: ${workers}\n` +
      `Max соединений: ${workers * 60000}\n\n` +
      `MTProxy перезапущен с новыми настройками.`,
     
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
  const nodes = queries.getActiveNodes.all([]) as any[];
  
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
    `📝 *Создание подписки*\n\n` +
    `Название: ${name}\n\n` +
    `Выберите ноды, которые будут включены в подписку:`,
    {  ...keyboard }
  );
});

/**
 * Список всех подписок
 */
bot.command('subscriptions', async (ctx) => {
  const subscriptions = queries.getAllSubscriptions.all([]) as any[];

  if (subscriptions.length === 0) {
    await ctx.reply('📭 Нет созданных подписок.\n\nИспользуйте /create_subscription для создания.');
    return;
  }

  let text = '📋 <b>Список подписок</b>\n\n';

  for (const sub of subscriptions) {
    const status = sub.is_active ? '🟢' : '🔴';
    const nodeIds = JSON.parse(sub.node_ids || '[]');
    
    text += `${status} <b>${sub.name}</b>\n`;
    text += `ID: <code>${sub.id}</code>\n`;
    text += `Нод: ${nodeIds.length}\n`;
    text += `MTProto: ${sub.include_mtproto ? '✅' : '❌'} | SOCKS5: ${sub.include_socks5 ? '✅' : '❌'}\n`;
    text += `Обращений: ${sub.access_count}\n`;
    text += `\n`;
  }

  text += `\nИспользуйте /subscription &lt;id&gt; для подробностей`;

  await ctx.reply(text, { parse_mode: 'HTML' });
});

/**
 * Детали подписки
 * Использование: /subscription <id>
 */
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
    text += `*Прокси:*\n${proxyList}\n\n`;
    text += `*Готовые ссылки:*\n`;
    
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

    await ctx.reply(text, {  ...keyboard });

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
    text += `*Прокси:*\n${proxyList}\n\n`;
    text += `*Готовые ссылки:*\n`;
    
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

    await ctx.editMessageText(text, {  ...keyboard });
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
      text += `*Прокси:*\n${proxyList}\n\n`;
      text += `*Готовые ссылки:*\n`;
      
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

      await ctx.editMessageText(text, {  ...keyboard });
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
    `⚠️ *Удаление подписки*\n\n` +
    `Название: ${sub.name}\n\n` +
    `Вы уверены? Это действие нельзя отменить.`,
    {  ...keyboard }
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
     
    );
    
    await ctx.answerCbQuery('Удалено!');

  } catch (err: any) {
    await ctx.answerCbQuery(`Ошибка: ${err.message}`);
  }
});

// ═══════════════════════════════════════════════
// ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ (для диалогов)
// ═══════════════════════════════════════════════

bot.command('cancel', async (ctx) => {
  const userId = ctx.from.id;
  const state = userStates.get(userId);
  
  if (state && state.action) {
    userStates.delete(userId);
    await ctx.reply('❌ Действие отменено.');
  } else {
    await ctx.reply('Нет активных действий для отмены.');
  }
});

bot.on(message('text'), async (ctx) => {
  const userId = ctx.from.id;
  const state = userStates.get(userId);
  const text = ctx.message.text;
  
  console.log(`[TextHandler] User ${userId} sent text:`, text);
  console.log(`[TextHandler] Current state:`, state);
  
  if (!state || !state.action) {
    console.log('[TextHandler] No active state, ignoring message');
    return; // Игнорируем обычные сообщения
  }

  console.log(`[TextHandler] Processing action: ${state.action}`);

  // ─── Добавление ноды ───
  if (state.action === 'add_node') {
    try {
      // Парсим данные из сообщения
      const data: any = {};
      const lines = text.split('\n');
      
      for (const line of lines) {
        const [key, ...valueParts] = line.split(':');
        if (!key || valueParts.length === 0) continue;
        
        const value = valueParts.join(':').trim();
        const cleanKey = key.trim().toLowerCase().replace(/\s+/g, '_');
        data[cleanKey] = value;
      }

      // Валидация обязательных полей (только 3 поля!)
      const required = ['name', 'ip', 'api_key'];
      const missing = required.filter(field => !data[field]);
      
      if (missing.length > 0) {
        await ctx.reply(
          `❌ Не хватает полей: ${missing.join(', ')}\n\n` +
          'Отправьте данные снова или /cancel для отмены.'
        );
        return;
      }

      // Проверяем доступность API ноды
      await ctx.reply('⏳ Подключаюсь к ноде...');
      
      const apiUrl = `http://${data.ip}:3000`;
      
      // Добавляем ноду в БД сразу
      const result = queries.insertNode.run({
        name: data.name,
        domain: data.ip,
        ip: data.ip,
        api_url: apiUrl,
        api_token: data.api_key,
        mtproto_port: 443,
        socks5_port: 1080,
        workers: 2,
        cpu_cores: 2,
        ram_mb: 2048,
        status: 'pending',
      });

        const nodeId = (result as any).lastInsertRowid;
      
      try {
        // Получаем клиента через getNodeClient
        const testClient = getNodeClient(nodeId);
        if (!testClient) {
          throw new Error('Не удалось создать API клиента');
        }
        
        // Проверяем подключение
        await testClient.getHealth();
        
        // Обновляем статус на online
        queries.updateNodeStatus.run({ status: 'online', id: nodeId });

        // Очищаем состояние
        userStates.delete(userId);

        await ctx.reply(
          `✅ Нода успешно добавлена!\n\n` +
          `🆔 ID: ${nodeId}\n` +
          `📛 Имя: ${data.name}\n` +
          `📡 IP: ${data.ip}\n` +
          `� API URL: ${apiUrl}\n` +
          `✅ Статус: Онлайн\n\n` +
          `Теперь настройте прокси через:\n` +
          `/add_secret ${nodeId} - добавить MTProxy\n` +
          `/add_socks5 ${nodeId} - добавить SOCKS5\n\n` +
          `Просмотр: /node ${nodeId}`
        );

      } catch (apiErr: any) {
        // Удаляем ноду если не удалось подключиться
        queries.deleteNode.run(nodeId);
        
        await ctx.reply(
          `❌ Не удалось подключиться к ноде:\n${apiErr.message}\n\n` +
          `Проверьте:\n` +
          `- Нода запущена (mtproxy-node status)\n` +
          `- Порт 3000 открыт\n` +
          `- API KEY правильный\n\n` +
          `Попробуйте снова или /cancel`
        );
        return;
      }

    } catch (err: any) {
      await ctx.reply(`❌ Ошибка при добавлении ноды: ${err.message}`);
      userStates.delete(userId);
    }
  }

  // ─── Выбор домена для MTProto ───
  if (state.action === 'add_secret_domain') {
    console.log('[MTProto] Processing domain input:', text);
    const domain = text.trim();
    
    if (!domain) {
      await ctx.reply('❌ Домен не может быть пустым. Отправьте домен или /cancel для отмены.');
      return;
    }

    // Валидация домена
    const domainRegex = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!domainRegex.test(domain)) {
      await ctx.reply('❌ Неверный формат домена. Отправьте корректный домен или /cancel для отмены.');
      return;
    }

    const node = queries.getNodeById.get(state.nodeId) as any;
    if (!node) {
      await ctx.reply('❌ Нода не найдена');
      userStates.delete(userId);
      return;
    }

    const isFakeTls = state.isFakeTls || false;
    const typeText = isFakeTls ? 'Fake-TLS (DD)' : 'Обычный';

    console.log(`[MTProto] Adding secret to node ${node.id} (${node.name})`);
    console.log(`[MTProto] Secret: ${state.secret}, Domain: ${domain}, FakeTLS: ${isFakeTls}`);

    try {
      // Показываем прогресс
      await ctx.reply('⏳ Добавляю секрет на ноду...');

      // Добавляем секрет в БД
      console.log('[MTProto] Inserting secret to database...');
      queries.insertSecret.run({
        node_id: state.nodeId,
        secret: state.secret,
        is_fake_tls: isFakeTls ? 1 : 0,
        description: `Домен: ${domain}`,
      });
      console.log('[MTProto] Secret added to database');

      // Отправляем на ноду
      const client = getNodeClient(state.nodeId!);
      if (!client) {
        throw new Error('Не удалось подключиться к ноде');
      }

      console.log('[MTProto] Calling node API to add secret...');
      await client.addMtProtoSecret({
        secret: state.secret!,
        isFakeTls: isFakeTls,
        description: `Домен: ${domain}`
      });
      console.log('[MTProto] Secret added to node successfully');

      // Генерируем ссылку
      const link = ProxyLinkGenerator.generateMtProtoLink(domain, 443, state.secret!, isFakeTls);
      console.log('[MTProto] Generated link:', link);

      userStates.delete(userId);

      await ctx.reply(
        `✅ <b>MTProto секрет добавлен!</b>\n\n` +
        `Нода: ${node.name}\n` +
        `Тип: ${typeText}\n` +
        `Домен: ${domain}\n\n` +
        `Ссылка:\n<code>${link}</code>`,
        { parse_mode: 'HTML' }
      );

      console.log('[MTProto] Process completed successfully');

    } catch (err: any) {
      console.error('[MTProto] Error adding secret:', err);
      userStates.delete(userId);
      await ctx.reply(
        `❌ <b>Ошибка при добавлении секрета:</b>\n\n` +
        `${err.message}\n\n` +
        `Попробуйте:\n` +
        `• Проверить что нода доступна: /health\n` +
        `• Перезапустить ноду: /restart_node ${state.nodeId}`,
        { parse_mode: 'HTML' }
      );
    }
  }

  // ─── Выбор IP для MTProto ───
  if (state.action === 'add_secret_ip') {
    console.log('[MTProto] Processing IP input:', text);
    const ip = text.trim();
    
    if (!ip) {
      await ctx.reply('❌ IP адрес не может быть пустым. Отправьте IP или /cancel для отмены.');
      return;
    }

    // Валидация IP
    const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (!ipRegex.test(ip)) {
      await ctx.reply('❌ Неверный формат IP адреса. Отправьте корректный IP или /cancel для отмены.');
      return;
    }

    const node = queries.getNodeById.get(state.nodeId) as any;
    if (!node) {
      await ctx.reply('❌ Нода не найдена');
      userStates.delete(userId);
      return;
    }

    const isFakeTls = state.isFakeTls || false;
    const typeText = isFakeTls ? 'Fake-TLS (DD)' : 'Обычный';

    console.log(`[MTProto] Adding secret to node ${node.id} (${node.name})`);
    console.log(`[MTProto] Secret: ${state.secret}, IP: ${ip}, FakeTLS: ${isFakeTls}`);

    try {
      // Показываем прогресс
      await ctx.reply('⏳ Добавляю секрет на ноду...');

      // Добавляем секрет в БД
      console.log('[MTProto] Inserting secret to database...');
      queries.insertSecret.run({
        node_id: state.nodeId,
        secret: state.secret,
        is_fake_tls: isFakeTls ? 1 : 0,
        description: `IP: ${ip}`,
      });
      console.log('[MTProto] Secret added to database');

      // Отправляем на ноду
      const client = getNodeClient(state.nodeId!);
      if (!client) {
        throw new Error('Не удалось подключиться к ноде');
      }

      console.log('[MTProto] Calling node API to add secret...');
      await client.addMtProtoSecret({
        secret: state.secret!,
        isFakeTls: isFakeTls,
        description: `IP: ${ip}`
      });
      console.log('[MTProto] Secret added to node successfully');

      // Генерируем ссылку
      const link = ProxyLinkGenerator.generateMtProtoLink(ip, 443, state.secret!, isFakeTls);
      console.log('[MTProto] Generated link:', link);

      userStates.delete(userId);

      await ctx.reply(
        `✅ <b>MTProto секрет добавлен!</b>\n\n` +
        `Нода: ${node.name}\n` +
        `Тип: ${typeText}\n` +
        `IP: ${ip}\n\n` +
        `Ссылка:\n<code>${link}</code>`,
        { parse_mode: 'HTML' }
      );

      console.log('[MTProto] Process completed successfully');

    } catch (err: any) {
      console.error('[MTProto] Error adding secret:', err);
      userStates.delete(userId);
      await ctx.reply(
        `❌ <b>Ошибка при добавлении секрета:</b>\n\n` +
        `${err.message}\n\n` +
        `Попробуйте:\n` +
        `• Проверить что нода доступна: /health\n` +
        `• Перезапустить ноду: /restart_node ${state.nodeId}`,
        { parse_mode: 'HTML' }
      );
    }
  }

  // ─── Добавление SOCKS5 аккаунта ───
  if (state.action === 'add_socks5') {
    const lines = text.trim().split('\n');
    let username = '';
    let password = '';

    // Парсим данные
    for (const line of lines) {
      const [key, ...valueParts] = line.split(':');
      if (!key || valueParts.length === 0) continue;
      
      const value = valueParts.join(':').trim();
      const cleanKey = key.trim().toLowerCase();
      
      if (cleanKey === 'username') username = value;
      if (cleanKey === 'password') password = value;
    }

    // Валидация
    if (!username || !password) {
      await ctx.reply(
        '❌ Некорректный формат. Отправьте данные в формате:\n\n' +
        'username: myuser\n' +
        'password: mypass\n\n' +
        'Или /cancel для отмены.'
      );
      return;
    }

    const node = queries.getNodeById.get(state.nodeId) as any;
    if (!node) {
      await ctx.reply('❌ Нода не найдена');
      userStates.delete(userId);
      return;
    }

    const client = getNodeClient(state.nodeId!);
    if (!client) {
      await ctx.reply('❌ Не удалось подключиться к ноде');
      userStates.delete(userId);
      return;
    }

    try {
      // Добавляем в БД
      queries.insertSocks5Account.run({
        node_id: state.nodeId,
        username,
        password,
        description: `Added by admin ${userId}`,
      });

      // Отправляем на Node Agent
      await client.addSocks5Account({ username, password });

      // Генерируем ссылки
      const tgLink = ProxyLinkGenerator.generateSocks5TgLink(
        node.domain,
        node.socks5_port,
        username,
        password
      );

      userStates.delete(userId);

      await ctx.reply(
        `✅ *SOCKS5 прокси успешно создан!*\n\n` +
        `🌐 *Нода:* ${node.name}\n` +
        `👤 *Username:* \`${username}\`\n` +
        `🔑 *Password:* \`${password}\`\n\n` +
        `───────────────\n\n` +
        `🔗 *Deep Link:*\n` +
        `\`${tgLink}\`\n\n` +
        `👇 *Подключить в 1 клик:*`,
        {
          parse_mode: 'Markdown',
          link_preview_options: { is_disabled: true },
          ...Markup.inlineKeyboard([
            [Markup.button.url('🚀 Подключить прокси', tgLink)]
          ])
        }
      );

      queries.insertLog.run({
        node_id: state.nodeId,
        level: 'info',
        message: 'SOCKS5 account added',
        details: `Username: ${username}, Admin: ${userId}`,
      });

    } catch (err: any) {
      await ctx.reply(`❌ Ошибка при добавлении: ${err.message}`);
      userStates.delete(userId);
    }
  }
});

// ═══════════════════════════════════════════════
// УПРАВЛЕНИЕ ССЫЛКАМИ
// ═══════════════════════════════════════════════

bot.action('manage_links', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    console.log('manage_links action triggered by user:', ctx.from?.id);

    const nodes = queries.getAllNodes.all([]) as any[];
    console.log('Found nodes:', nodes.length, 'nodes data:', nodes);

    if (nodes.length === 0) {
      console.log('No nodes found, showing message');
      return await ctx.editMessageText('📭 Нет добавленных нод.\n\nСначала добавьте ноду через /add_node', {
        reply_markup: {
          inline_keyboard: [[{ text: '⬅️ Назад', callback_data: 'back_to_main' }]]
        }
      });
    }

    let text = '🔗 <b>Управление ссылками</b>\n\nВыберите ноду для управления ссылками:\n\n';

    const buttons = [];
    for (const node of nodes) {
      const statusEmoji = node.status === 'online' ? '🟢' : 
                         node.status === 'offline' ? '🔴' : '🟡';
      
      text += `${statusEmoji} <b>${node.name}</b>\n`;
      
      // Получаем количество ссылок
      const secrets = queries.getNodeSecrets.all(node.id) as any[];
      const socks5Accounts = queries.getNodeSocks5Accounts.all(node.id) as any[];
      const totalLinks = secrets.length + socks5Accounts.length;
      
      text += `   Ссылок: ${totalLinks}\n\n`;
      
      buttons.push([{ text: `${node.name} (${totalLinks})`, callback_data: `manage_node_links_${node.id}` }]);
    }
    
    buttons.push([{ text: '⬅️ Назад', callback_data: 'back_to_main' }]);
    
    console.log('Editing message with buttons, text length:', text.length);
    const result = await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: buttons
      }
    });
    console.log('Edit result:', result);
  } catch (error) {
    console.error('Error in manage_links action:', error);
    try {
      await ctx.answerCbQuery('Произошла ошибка');
    } catch (e) {
      console.error('Error answering callback query:', e);
    }
  }
});async function showManageNodeLinks(ctx: any, nodeId: number) {
  const node = queries.getNodeById.get(nodeId) as any;
  if (!node) {
    await ctx.answerCbQuery('Нода не найдена');
    return;
  }

  const secrets = queries.getNodeSecrets.all(nodeId) as any[];
  const socks5Accounts = queries.getNodeSocks5Accounts.all(nodeId) as any[];

  let text = `🔗 <b>Управление ссылками - ${node.name}</b>\n\n`;
  const buttons: any[][] = [];

  // MTProto ссылки
  if (secrets.length > 0) {
    text += `🟣 <b>MTProto (${secrets.length}):</b>\n`;
    for (const secret of secrets) {
      const type = secret.is_fake_tls ? '🔒 Fake-TLS' : '🔓 Обычный';
      const link = ProxyLinkGenerator.generateMtProtoLink(
        node.domain,
        node.mtproto_port,
        secret.secret,
        secret.is_fake_tls
      );
      text += `   ${type}:\n`;
      if (secret.description) text += `   <i>${secret.description}</i>\n`;
      text += `   <code>${link}</code>\n`;
      buttons.push([{ text: `🗑️ Удалить MTProto ${secret.secret.slice(-8)}`, callback_data: `delete_mtproto_${secret.id}` }]);
    }
    text += '\n';
  }

  // SOCKS5 аккаунты
  if (socks5Accounts.length > 0) {
    text += `🔵 <b>SOCKS5 (${socks5Accounts.length}):</b>\n`;
    for (const account of socks5Accounts) {
      const tgLink = ProxyLinkGenerator.generateSocks5TgLink(
        node.domain,
        node.socks5_port,
        account.username,
        account.password
      );
      text += `   👤 ${account.username}:\n`;
      if (account.description) text += `   <i>${account.description}</i>\n`;
      text += `   <code>${tgLink}</code>\n`;
      buttons.push([{ text: `🗑️ Удалить SOCKS5 ${account.username}`, callback_data: `delete_socks5_${account.id}` }]);
    }
    text += '\n';
  }

  if (secrets.length === 0 && socks5Accounts.length === 0) {
    text += '📭 Ссылок пока нет.\n\n';
  }

  // Кнопки добавления
  buttons.push([
    { text: '➕ MTProto', callback_data: `add_secret_${nodeId}` },
    { text: '➕ SOCKS5', callback_data: `add_socks5_${nodeId}` }
  ]);
  buttons.push([{ text: '⬅️ Назад', callback_data: 'manage_links' }]);

  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: buttons
    }
  });
}

bot.action(/^manage_node_links_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const nodeId = parseInt(ctx.match[1]);
  await showManageNodeLinks(ctx, nodeId);
});

// ─── УДАЛЕНИЕ ССЫЛОК ───

bot.action(/^delete_mtproto_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const secretId = parseInt(ctx.match[1]);
  const secret = queries.getSecretById.get(secretId) as any;
  
  if (!secret) {
    await ctx.answerCbQuery('Секрет не найден');
    return;
  }

  const node = queries.getNodeById.get(secret.node_id) as any;
  if (!node) {
    await ctx.answerCbQuery('Нода не найдена');
    return;
  }

  // Удаляем из БД
  queries.deactivateSecret.run(secretId);

  // Отправляем на Node Agent для обновления конфига
  const client = getNodeClient(secret.node_id);
  if (client) {
    try {
      await client.removeMtProtoSecret(secret.secret);
    } catch (err) {
      console.error('Failed to remove secret from node:', err);
    }
  }

  await ctx.answerCbQuery('MTProto секрет удален');
  
  // Обновляем сообщение
  await showManageNodeLinks(ctx, secret.node_id);
});

bot.action(/^delete_socks5_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const accountId = parseInt(ctx.match[1]);
  const account = queries.getSocks5AccountById.get(accountId) as any;
  
  if (!account) {
    await ctx.answerCbQuery('Аккаунт не найден');
    return;
  }

  const node = queries.getNodeById.get(account.node_id) as any;
  if (!node) {
    await ctx.answerCbQuery('Нода не найдена');
    return;
  }

  // Удаляем из БД
  queries.deactivateSocks5Account.run(accountId);

  // Отправляем на Node Agent для обновления конфига
  const client = getNodeClient(account.node_id);
  if (client) {
    try {
      await client.removeSocks5Account(account.username);
    } catch (err) {
      console.error('Failed to remove SOCKS5 account from node:', err);
    }
  }

  await ctx.answerCbQuery('SOCKS5 аккаунт удален');
  
  // Обновляем сообщение
  await showManageNodeLinks(ctx, account.node_id);
});

// ═══════════════════════════════════════════════
// ЗАПУСК
// ═══════════════════════════════════════════════

// Каждые 5 минут — проверка здоровья нод и сбор статистики
cron.schedule('*/5 * * * *', async () => {
  console.log('[Cron] Проверка здоровья нод...');
  
  const nodes = queries.getActiveNodes.all([]) as any[];

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

      console.log(`[Cron] Node ${node.name}: ${health.status}`);
    } catch (err: any) {
      console.error(`[Cron] Error checking node ${node.name}:`, err.message);
      
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

// Раз в день — очистка старых данных
cron.schedule('0 3 * * *', async () => {
  console.log('[Cron] Очистка старых данных...');
  queries.cleanOldStats.run([]);
  queries.cleanOldLogs.run([]);
  console.log('[Cron] Очистка завершена');
});

// ═══════════════════════════════════════════════
// ЗАПУСК
// ═══════════════════════════════════════════════

export function startBot() {
  bot.launch({
    dropPendingUpdates: true,
  });

  console.log('🤖 MTProxy Management Bot запущен!');
  console.log(`👑 Админы: ${ADMIN_IDS.join(', ')}`);

  // Graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

// Автозапуск при прямом вызове
if (require.main === module) {
  startBot();
}
