import { Telegraf, Markup, Context } from 'telegraf';
import { message } from 'telegraf/filters';
import { queries } from './database-new';
import { NodeApiClient, ProxyLinkGenerator, SecretGenerator } from './node-client';
import cron from 'node-cron';

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
// УПРАВЛЕНИЕ НОДАМИ
// ═══════════════════════════════════════════════

bot.command('nodes', async (ctx) => {
  const nodes = queries.getAllNodes.all() as any[];
  
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
});

bot.command('add_node', async (ctx) => {
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
    'API токен будет сгенерирован автоматически.',
    { parse_mode: 'Markdown' }
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
      const link = ProxyLinkGenerator.generateSocks5Link(
        node.domain,
        node.socks5_port,
        account.username,
        account.password
      );
      
      text += `👤 ${account.username}\n`;
      if (account.description) text += `_${account.description}_\n`;
      text += `\`${link}\`\n\n`;
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

// ═══════════════════════════════════════════════
// МОНИТОРИНГ
// ═══════════════════════════════════════════════

bot.command('stats', async (ctx) => {
  const nodes = queries.getActiveNodes.all() as any[];
  const allStats = queries.getAllNodesLatestStats.all() as any[];
  
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
  const nodes = queries.getActiveNodes.all() as any[];
  
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

// ═══════════════════════════════════════════════
// CRON: МОНИТОРИНГ
// ═══════════════════════════════════════════════

// Каждые 5 минут — проверка здоровья нод и сбор статистики
cron.schedule('*/5 * * * *', async () => {
  console.log('[Cron] Проверка здоровья нод...');
  
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
  queries.cleanOldStats.run();
  queries.cleanOldLogs.run();
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
