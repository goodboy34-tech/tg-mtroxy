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
  action: 'add_node' | 'add_secret' | 'add_socks5' | null;
  nodeId?: number;
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
 * Экранирование специальных символов Markdown
 * Не экранируем: . (точка) - она используется в доменах и IP
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}!\\]/g, '\\$&');
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
  await ctx.reply(
    '👋 *MTProxy Management Bot*\n\n' +
    'Управление прокси-серверами через Telegram.\n\n' +
    'Основные команды:\n' +
    '/nodes - список нод\n' +
    '/add\\_node - добавить ноду\n' +
    '/stats - общая статистика\n' +
    '/help - справка',
    { parse_mode: 'Markdown' }
  );
});

bot.help(async (ctx) => {
  await ctx.reply(
    '📖 *Справка по командам*\n\n' +
    '*Управление нодами:*\n' +
    '/nodes - список всех нод\n' +
    '/add\\_node - добавить новую ноду\n' +
    '/node <id> - информация о ноде\n' +
    '/remove\\_node <id> - удалить ноду\n' +
    '/restart\\_node <id> - перезапустить прокси\n\n' +
    '*Получение доступов:*\n' +
    '/links <node\\_id> - получить все ссылки\n' +
    '/add\\_secret <node\\_id> - добавить секрет\n' +
    '/add\\_socks5 <node\\_id> - добавить SOCKS5 аккаунт\n\n' +
    '*Подписки:*\n' +
    '/create\\_subscription <название> - создать подписку\n' +
    '/subscriptions - список всех подписок\n' +
    '/subscription <id> - детали подписки\n\n' +
    '*Мониторинг:*\n' +
    '/stats - общая статистика\n' +
    '/health - здоровье всех нод\n' +
    '/logs <node\\_id> - логи ноды\n\n' +
    '*Настройки:*\n' +
    '/set\\_workers <node\\_id> <count> - воркеры\n' +
    '/update\\_node <id> - обновить конфиг',
    { parse_mode: 'Markdown' }
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

  let text = '📡 *Список нод:*\n\n';
  
  for (const node of nodes) {
    const statusEmoji = node.status === 'online' ? '🟢' : 
                       node.status === 'offline' ? '🔴' : '🟡';
    
    text += `${statusEmoji} *${node.name}*\n`;
    text += `   ID: \`${node.id}\`\n`;
    text += `   Домен: \`${node.domain}\`\n`;
    text += `   Статус: ${node.status}\n`;
    text += `   Воркеры: ${node.workers}\n`;
    text += `   /node ${node.id}\n\n`;
  }

  await ctx.reply(text, { parse_mode: 'Markdown' });
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
        
        healthInfo = `\n*Статус:* ${health.status === 'healthy' ? '✅ Здорова' : '⚠️ Проблемы'}\n` +
                     `*Uptime:* ${Math.floor(health.uptime / 3600)}ч ${Math.floor((health.uptime % 3600) / 60)}м\n` +
                     `*CPU:* ${health.system.cpuUsage.toFixed(1)}%\n` +
                     `*RAM:* ${health.system.ramUsage.toFixed(1)}%\n`;
        
        statsInfo = `\n*MTProto:*\n` +
                    `  Подключений: ${stats.mtproto.connections}/${stats.mtproto.maxConnections}\n` +
                    `  Telegram серверов: ${stats.mtproto.activeTargets}/${stats.mtproto.readyTargets}\n` +
                    `*SOCKS5:*\n` +
                    `  Подключений: ${stats.socks5.connections}\n` +
                    `*Трафик:*\n` +
                    `  ⬇️ ${stats.network.inMb.toFixed(2)} MB\n` +
                    `  ⬆️ ${stats.network.outMb.toFixed(2)} MB\n`;
      }
    } catch (err: any) {
      healthInfo = `\n⚠️ Не удалось получить статус: ${err.message}\n`;
    }

    await ctx.reply(
      `📡 *Нода: ${node.name}*\n\n` +
      `*ID:* \`${node.id}\`\n` +
      `*Домен:* \`${node.domain}\`\n` +
      `*IP:* \`${node.ip}\`\n` +
      `*MTProto порт:* ${node.mtproto_port}\n` +
      `*SOCKS5 порт:* ${node.socks5_port}\n` +
      `*Воркеры:* ${node.workers}\n` +
      `*CPU ядер:* ${node.cpu_cores}\n` +
      `*RAM:* ${node.ram_mb} MB\n` +
      healthInfo +
      statsInfo +
      `\n*Команды:*\n` +
      `/links ${node.id} - получить ссылки\n` +
      `/restart_node ${node.id} - перезапустить\n` +
      `/logs ${node.id} - показать логи`,
      { parse_mode: 'Markdown' }
    );
  } catch (err: any) {
    await ctx.reply(`❌ Ошибка при получении информации о ноде: ${err.message}`);
  }
});

bot.command('add_node', async (ctx) => {
  // Устанавливаем состояние ожидания данных ноды
  userStates.set(ctx.from.id, { action: 'add_node' });
  
  await ctx.reply(
    '➕ *Добавление новой ноды*\n\n' +
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
    'API токен будет сгенерирован автоматически.\n\n' +
    'Отправьте /cancel для отмены.',
    { parse_mode: 'Markdown' }
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
      
      text += `👤 ${account.username}\n`;
      if (account.description) text += `_${account.description}_\n`;
      text += `\`${tgLink}\`\n`;
      text += `[Подключить](${tmeLink})\n\n`;
    }
  }

  await ctx.reply(text, { parse_mode: 'Markdown' });
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
    `🔐 *Добавление MTProto секрета*\n\n` +
    `Нода: ${node.name}\n` +
    `Секрет: \`${secret}\`\n\n` +
    `Выберите тип:`,
    {
      parse_mode: 'Markdown',
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
    `✅ *Секрет успешно добавлен!*\n\n` +
    `Нода: ${node.name}\n` +
    `Тип: ${isFakeTls ? 'Fake-TLS (dd)' : 'Обычный'}\n\n` +
    `Ссылка:\n\`${link}\``,
    { parse_mode: 'Markdown' }
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
    `🔐 *Добавление SOCKS5 аккаунта*\n\n` +
    `Нода: ${node.name}\n` +
    `Username: \`${username}\`\n` +
    `Password: \`${password}\`\n\n` +
    `Подтвердите добавление:`,
    {
      parse_mode: 'Markdown',
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
      `✅ *SOCKS5 аккаунт успешно добавлен!*\n\n` +
      `Нода: ${node.name}\n` +
      `Username: \`${username}\`\n` +
      `Password: \`${password}\`\n\n` +
      `*Ссылки для импорта:*\n` +
      `\`${tgLink}\`\n\n` +
      `\`${tmeLink}\``,
      { parse_mode: 'Markdown' }
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
  const nodes = queries.getActiveNodes.all([]) as any[];
  const allStats = queries.getAllNodesLatestStats.all([]) as any[];
  
  let text = '📊 *Общая статистика*\n\n';
  text += `Нод активно: ${nodes.length}\n\n`;

  let totalMtprotoConnections = 0;
  let totalSocks5Connections = 0;

  for (const stat of allStats) {
    totalMtprotoConnections += stat.mtproto_connections || 0;
    totalSocks5Connections += stat.socks5_connections || 0;
    
    text += `*${stat.node_name}*\n`;
    text += `  MTProto: ${stat.mtproto_connections}/${stat.mtproto_max}\n`;
    text += `  SOCKS5: ${stat.socks5_connections}\n`;
    text += `  CPU: ${stat.cpu_usage?.toFixed(1)}% | RAM: ${stat.ram_usage?.toFixed(1)}%\n\n`;
  }

  text += `*Итого:*\n`;
  text += `MTProto подключений: ${totalMtprotoConnections}\n`;
  text += `SOCKS5 подключений: ${totalSocks5Connections}\n`;

  await ctx.reply(text, { parse_mode: 'Markdown' });
});

bot.command('health', async (ctx) => {
  const nodes = queries.getActiveNodes.all([]) as any[];
  
  let text = '🏥 *Здоровье нод*\n\n';

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

    text += `*${node.name}*\n`;
    text += `Status: ${status}\n`;
    if (details) text += `${details}\n`;
    text += `\n`;
  }

  await ctx.reply(text, { parse_mode: 'Markdown' });
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

    await ctx.reply(text, { parse_mode: 'Markdown' });

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
      `✅ *Воркеры обновлены!*\n\n` +
      `Нода: ${node.name}\n` +
      `Воркеров: ${workers}\n` +
      `Max соединений: ${workers * 60000}\n\n` +
      `MTProxy перезапущен с новыми настройками.`,
      { parse_mode: 'Markdown' }
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
    { parse_mode: 'Markdown', ...keyboard }
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

  let text = '📋 *Список подписок*\n\n';

  for (const sub of subscriptions) {
    const status = sub.is_active ? '🟢' : '🔴';
    const nodeIds = JSON.parse(sub.node_ids || '[]');
    
    text += `${status} *${sub.name}*\n`;
    text += `ID: \`${sub.id}\`\n`;
    text += `Нод: ${nodeIds.length}\n`;
    text += `MTProto: ${sub.include_mtproto ? '✅' : '❌'} | SOCKS5: ${sub.include_socks5 ? '✅' : '❌'}\n`;
    text += `Обращений: ${sub.access_count}\n`;
    text += `\n`;
  }

  text += `\nИспользуйте /subscription <id> для подробностей`;

  await ctx.reply(text, { parse_mode: 'Markdown' });
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

    await ctx.reply(text, { parse_mode: 'Markdown', ...keyboard });

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

    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
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

      await ctx.editMessageText(text, { parse_mode: 'Markdown', ...keyboard });
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
    { parse_mode: 'Markdown', ...keyboard }
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
      { parse_mode: 'Markdown' }
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
  
  if (!state || !state.action) {
    return; // Игнорируем обычные сообщения
  }

  const text = ctx.message.text;

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

      // Валидация обязательных полей
      const required = ['name', 'domain', 'ip', 'api_url'];
      const missing = required.filter(field => !data[field]);
      
      if (missing.length > 0) {
        await ctx.reply(
          `❌ Не хватает полей: ${missing.join(', ')}\n\n` +
          'Отправьте данные снова или /cancel для отмены.'
        );
        return;
      }

      // Генерация API токена
      const apiToken = crypto.randomBytes(32).toString('hex');

      // Добавляем ноду в БД
      const result = queries.insertNode.run({
        name: data.name,
        domain: data.domain,
        ip: data.ip,
        api_url: data.api_url,
        api_token: apiToken,
        mtproto_port: parseInt(data.mtproto_port) || 443,
        socks5_port: parseInt(data.socks5_port) || 1080,
        workers: parseInt(data.workers) || 2,
        cpu_cores: parseInt(data.cpu_cores) || 2,
        ram_mb: parseInt(data.ram_mb) || 2048,
        status: 'pending',
      });

      const nodeId = (result as any).lastInsertRowid;

      // Очищаем состояние
      userStates.delete(userId);

      // Экранируем данные для Markdown
      const safeName = escapeMarkdown(data.name);
      const safeDomain = escapeMarkdown(data.domain);
      const safeIp = escapeMarkdown(data.ip);
      const safeApiUrl = escapeMarkdown(data.api_url);

      await ctx.reply(
        '✅ *Нода успешно добавлена\\!*\n\n' +
        `🆔 ID: \`${nodeId}\`\n` +
        `📛 Имя: ${safeName}\n` +
        `🌐 Домен: ${safeDomain}\n` +
        `📡 IP: ${safeIp}\n` +
        `🔗 API URL: ${safeApiUrl}\n` +
        `🔑 API токен: \`${apiToken}\`\n\n` +
        `⚠️ *Сохраните API токен\\!* Он нужен для установки node\\-agent на сервере\\.\n\n` +
        `Для установки ноды:\n` +
        `1\\. Скопируйте установочный скрипт из репозитория\n` +
        `2\\. Установите переменную API\\_TOKEN\\=${apiToken}\n` +
        `3\\. Запустите docker\\-compose на ноде\n\n` +
        `Проверить статус: /node ${nodeId}`,
        { parse_mode: 'Markdown' }
      );

    } catch (err: any) {
      await ctx.reply(`❌ Ошибка при добавлении ноды: ${err.message}`);
      userStates.delete(userId);
    }
  }
});

// ═══════════════════════════════════════════════
// CRON: МОНИТОРИНГ
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
