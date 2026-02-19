import dotenv from 'dotenv';
dotenv.config();

import { logger } from './logger';
import { initRedis, closeRedis } from './redis-client';
import { startBot } from './bot';
import { startRemnawaveApi } from './remnawave-api';
import { startWebApi } from './web-api';
import { startCleanupTasks } from './cleanup';

// Обработка необработанных ошибок
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown
async function shutdown() {
  logger.info('Получен сигнал завершения, закрываем соединения...');
  await closeRedis();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Инициализация
async function main() {
  try {
    logger.info('─────────────────────────────');
    logger.info('  MTProxy Control Panel');
    logger.info('─────────────────────────────');

    // Инициализация Redis
    logger.info('Инициализация Redis...');
    await initRedis();

    // Запуск сервисов
    logger.info('Запуск сервисов...');
    startBot();
    startRemnawaveApi();
    startWebApi();

    // Запуск задач очистки
    logger.info('Запуск задач очистки...');
    startCleanupTasks();

    logger.info('✅ Все сервисы запущены успешно');
  } catch (error) {
    logger.error('Ошибка при запуске:', error);
    process.exit(1);
  }
}

main();


