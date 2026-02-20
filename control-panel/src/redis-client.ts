/**
 * Redis клиент для кэширования (обязателен для продакшена)
 * Используется для кэширования данных Remnawave, пользователей и метрик
 */

import { createClient, RedisClientType } from 'redis';
import { logger } from './logger';

let redisClient: RedisClientType | null = null;
let isConnected = false;

const REDIS_HOST = process.env.REDIS_HOST || 'redis';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');

/**
 * Инициализация Redis клиента
 */
export async function initRedis(): Promise<void> {
  try {
    redisClient = createClient({
      socket: {
        host: REDIS_HOST,
        port: REDIS_PORT,
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.error('Redis: Превышено количество попыток переподключения');
            return new Error('Redis connection failed');
          }
          return Math.min(retries * 100, 3000);
        },
      },
    });

    redisClient.on('error', (err) => {
      logger.error('Redis error:', err);
      isConnected = false;
    });

    redisClient.on('connect', () => {
      logger.info('Redis: Подключение установлено');
    });

    redisClient.on('ready', () => {
      logger.info('Redis: Клиент готов к работе');
      isConnected = true;
    });

    redisClient.on('reconnecting', () => {
      logger.warn('Redis: Переподключение...');
      isConnected = false;
    });

    await redisClient.connect();
  } catch (error) {
    logger.error('Redis: Ошибка инициализации:', error);
    throw error;
  }
}

/**
 * Закрытие соединения с Redis
 */
export async function closeRedis(): Promise<void> {
  if (redisClient && isConnected) {
    await redisClient.quit();
    redisClient = null;
    isConnected = false;
    logger.info('Redis: Соединение закрыто');
  }
}

/**
 * Получить значение из кэша
 */
export async function get<T>(key: string): Promise<T | null> {
  if (!redisClient || !isConnected) {
    return null;
  }

  try {
    const value = await redisClient.get(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  } catch (error) {
    logger.error(`Redis get error for key ${key}:`, error);
    return null;
  }
}

/**
 * Установить значение в кэш
 */
export async function set<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
  if (!redisClient || !isConnected) {
    return;
  }

  try {
    const serialized = JSON.stringify(value);
    await redisClient.setEx(key, ttlSeconds, serialized);
  } catch (error) {
    logger.error(`Redis set error for key ${key}:`, error);
  }
}

/**
 * Удалить значение из кэша
 */
export async function del(key: string): Promise<void> {
  if (!redisClient || !isConnected) {
    return;
  }

  try {
    await redisClient.del(key);
  } catch (error) {
    logger.error(`Redis del error for key ${key}:`, error);
  }
}

/**
 * Очистить весь кэш (осторожно!)
 */
export async function clear(): Promise<void> {
  if (!redisClient || !isConnected) {
    return;
  }

  try {
    await redisClient.flushDb();
    logger.warn('Redis: Весь кэш очищен');
  } catch (error) {
    logger.error('Redis clear error:', error);
  }
}

/**
 * Получить статистику Redis
 */
export async function getStats(): Promise<{ memory: string; keys: number; connected: boolean }> {
  if (!redisClient || !isConnected) {
    return { memory: '0', keys: 0, connected: false };
  }

  try {
    const info = await redisClient.info('memory');
    const keys = await redisClient.dbSize();
    
    const memoryMatch = info.match(/used_memory_human:(.+)/);
    const memory = memoryMatch ? memoryMatch[1].trim() : 'unknown';

    return { memory, keys, connected: true };
  } catch (error) {
    logger.error('Redis stats error:', error);
    return { memory: '0', keys: 0, connected: false };
  }
}

/**
 * Проверка подключения
 */
export function isRedisConnected(): boolean {
  return isConnected && redisClient !== null;
}

