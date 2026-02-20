// dotenv не нужен в Docker - переменные передаются через docker-compose environment
// Загружаем только если файл существует (для локальной разработки)
import dotenv from 'dotenv';
try {
  dotenv.config();
} catch (error) {
  // Игнорируем ошибки dotenv - переменные уже переданы через Docker
}

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

main().catch((error) => {
  logger.error('Ошибка в main():', error);
  process.exit(1);
});


