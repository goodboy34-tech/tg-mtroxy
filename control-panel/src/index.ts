// Раннее логирование до инициализации logger
console.log('[DEBUG] Starting application...');
console.log('[DEBUG] NODE_ENV:', process.env.NODE_ENV);
console.log('[DEBUG] Current directory:', process.cwd());
console.log('[DEBUG] Files in current directory:', require('fs').readdirSync(process.cwd()).join(', '));

import dotenv from 'dotenv';
const dotenvResult = dotenv.config();
console.log('[DEBUG] dotenv.config() result:', dotenvResult.error ? dotenvResult.error.message : 'success');
console.log('[DEBUG] BOT_TOKEN exists:', !!process.env.BOT_TOKEN);
console.log('[DEBUG] ADMIN_IDS exists:', !!process.env.ADMIN_IDS);
console.log('[DEBUG] REDIS_HOST:', process.env.REDIS_HOST || 'not set');
console.log('[DEBUG] REDIS_PORT:', process.env.REDIS_PORT || 'not set');

import { logger } from './logger';
console.log('[DEBUG] Logger initialized');
import { initRedis, closeRedis } from './redis-client';
import { startBot } from './bot';
import { startRemnawaveApi } from './remnawave-api';
import { startWebApi } from './web-api';
import { startCleanupTasks } from './cleanup';

// Обработка необработанных ошибок
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
  try {
    logger.error('Uncaught Exception:', error);
  } catch (e) {
    console.error('[FATAL] Logger failed:', e);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason);
  try {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  } catch (e) {
    console.error('[FATAL] Logger failed:', e);
  }
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
  console.log('[DEBUG] main() function called');
  try {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.ts:32',message:'Main function started',data:{nodeEnv:process.env.NODE_ENV,botToken:process.env.BOT_TOKEN?('set'):('missing'),adminIds:process.env.ADMIN_IDS?('set'):('missing'),redisHost:process.env.REDIS_HOST||'redis',redisPort:process.env.REDIS_PORT||'6379'},timestamp:Date.now(),runId:'bot_start',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    
    console.log('[DEBUG] About to call logger.info');
    logger.info('─────────────────────────────');
    logger.info('  MTProxy Control Panel');
    logger.info('─────────────────────────────');
    console.log('[DEBUG] Logger.info called successfully');

    // Инициализация Redis
    logger.info('Инициализация Redis...');
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.ts:42',message:'Starting Redis init',data:{redisHost:process.env.REDIS_HOST||'redis',redisPort:process.env.REDIS_PORT||'6379'},timestamp:Date.now(),runId:'bot_start',hypothesisId:'E'})}).catch(()=>{});
    // #endregion
    
    await initRedis();
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.ts:48',message:'Redis init completed',data:{},timestamp:Date.now(),runId:'bot_start',hypothesisId:'E'})}).catch(()=>{});
    // #endregion

    // Запуск сервисов
    logger.info('Запуск сервисов...');
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.ts:50',message:'Starting services',data:{},timestamp:Date.now(),runId:'bot_start',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    
    startBot();
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/42ca0ed9-7c0b-4e4a-941b-40dc83c65ad2',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'index.ts:54',message:'Bot started',data:{},timestamp:Date.now(),runId:'bot_start',hypothesisId:'D'})}).catch(()=>{});
    // #endregion
    
    startRemnawaveApi();
    startWebApi();

    // Запуск задач очистки
    logger.info('Запуск задач очистки...');
    startCleanupTasks();

    logger.info('✅ Все сервисы запущены успешно');
    console.log('[DEBUG] All services started successfully');
  } catch (error) {
    console.error('[FATAL] Error in main():', error);
    console.error('[FATAL] Error stack:', error instanceof Error ? error.stack : 'No stack');
    try {
      logger.error('Ошибка при запуске:', error);
    } catch (e) {
      console.error('[FATAL] Logger failed:', e);
    }
    process.exit(1);
  }
}

main();


