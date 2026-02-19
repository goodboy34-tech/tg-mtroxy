/**
 * Задачи самоочистки системы
 * - Очистка старых записей в БД
 * - Очистка старых логов
 * - Очистка Docker образов и контейнеров
 * - Очистка кэша Redis
 */

import cron from 'node-cron';
import { exec } from 'child_process';
import { promisify } from 'util';
import { queries } from './database';
import { logger } from './logger';
import * as redis from './redis-client';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

/**
 * Очистка старых записей в БД
 */
async function cleanupDatabase(): Promise<void> {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Удаление истекших подписок продаж старше 30 дней
    const expiredSubscriptions = queries.getExpiredUserSubscriptions.all() as any[];
    const oldExpired = expiredSubscriptions.filter(
      (sub: any) => new Date(sub.expires_at) < thirtyDaysAgo
    );

    for (const sub of oldExpired) {
      queries.deleteUserSubscription.run(sub.id);
    }

    if (oldExpired.length > 0) {
      logger.info(`Очищено ${oldExpired.length} старых истекших подписок из БД`);
    }

    // Удаление старых заказов (старше 30 дней, завершенных или отмененных)
    const allOrders = queries.getAllOrders.all() as any[];
    const oldOrders = allOrders.filter((order: any) => {
      const orderDate = new Date(order.created_at);
      return orderDate < thirtyDaysAgo && (order.status === 'completed' || order.status === 'cancelled');
    });

    for (const order of oldOrders) {
      queries.deleteOrder.run(order.id);
    }

    if (oldOrders.length > 0) {
      logger.info(`Очищено ${oldOrders.length} старых заказов из БД`);
    }

    // Удаление старых метрик (старше 7 дней)
    queries.deleteOldMetrics.run(sevenDaysAgo.toISOString());

    logger.info('Очистка БД завершена');
  } catch (error) {
    logger.error('Ошибка при очистке БД:', error);
  }
}

/**
 * Очистка старых логов (winston-daily-rotate-file делает это автоматически, но проверим)
 */
async function cleanupLogs(): Promise<void> {
  try {
    const logsDir = path.join(__dirname, '..', 'data', 'logs');
    if (!fs.existsSync(logsDir)) {
      return;
    }

    const files = fs.readdirSync(logsDir);
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    let deletedCount = 0;
    for (const file of files) {
      const filePath = path.join(logsDir, file);
      const stats = fs.statSync(filePath);
      
      // Удаляем файлы старше 30 дней
      if (now - stats.mtimeMs > thirtyDaysMs) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      logger.info(`Удалено ${deletedCount} старых лог-файлов`);
    }
  } catch (error) {
    logger.error('Ошибка при очистке логов:', error);
  }
}

/**
 * Очистка Docker образов и контейнеров
 */
async function cleanupDocker(): Promise<void> {
  try {
    // Удаление остановленных контейнеров старше 24 часов
    try {
      await execAsync('docker container prune -f --filter "until=24h"');
      logger.info('Очистка остановленных Docker контейнеров выполнена');
    } catch (error: any) {
      // Игнорируем ошибки, если Docker недоступен (например, на ноде)
      if (!error.message.includes('Cannot connect')) {
        logger.warn('Ошибка при очистке Docker контейнеров:', error.message);
      }
    }

    // Удаление неиспользуемых образов старше 7 дней
    try {
      await execAsync('docker image prune -af --filter "until=168h"');
      logger.info('Очистка неиспользуемых Docker образов выполнена');
    } catch (error: any) {
      if (!error.message.includes('Cannot connect')) {
        logger.warn('Ошибка при очистке Docker образов:', error.message);
      }
    }

    // Удаление неиспользуемых томов
    try {
      await execAsync('docker volume prune -f');
      logger.info('Очистка неиспользуемых Docker томов выполнена');
    } catch (error: any) {
      if (!error.message.includes('Cannot connect')) {
        logger.warn('Ошибка при очистке Docker томов:', error.message);
      }
    }
  } catch (error) {
    logger.error('Ошибка при очистке Docker:', error);
  }
}

/**
 * Очистка кэша Redis (удаление истекших ключей)
 */
async function cleanupRedisCache(): Promise<void> {
  try {
    if (!redis.isRedisConnected()) {
      return;
    }

    // Redis автоматически удаляет истекшие ключи благодаря TTL
    // Но можем очистить старые ключи с префиксом, если нужно
    const stats = await redis.getStats();
    logger.info(`Redis статистика: память=${stats.memory}, ключей=${stats.keys}, подключен=${stats.connected}`);
  } catch (error) {
    logger.error('Ошибка при очистке Redis кэша:', error);
  }
}

/**
 * Запуск всех задач очистки
 */
export function startCleanupTasks(): void {
  // Ежедневная очистка в 3:00 утра
  cron.schedule('0 3 * * *', async () => {
    logger.info('Запуск ежедневной очистки...');
    await cleanupDatabase();
    await cleanupLogs();
    await cleanupDocker();
    await cleanupRedisCache();
    logger.info('Ежедневная очистка завершена');
  });

  // Очистка БД каждые 6 часов (для быстрой очистки истекших подписок)
  cron.schedule('0 */6 * * *', async () => {
    logger.info('Запуск периодической очистки БД...');
    await cleanupDatabase();
  });

  // Очистка Docker каждые 12 часов
  cron.schedule('0 */12 * * *', async () => {
    logger.info('Запуск периодической очистки Docker...');
    await cleanupDocker();
  });

  logger.info('Задачи самоочистки запущены');
}

