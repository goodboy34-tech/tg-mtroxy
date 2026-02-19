/**
 * Унифицированный интерфейс кэша (использует Redis)
 * Используется для кэширования данных Remnawave и пользователей
 */

import * as redis from './redis-client';
import { logger } from './logger';

class Cache {
  /**
   * Установить значение в кэш
   */
  async set<T>(key: string, value: T, ttlSeconds: number = 300): Promise<void> {
    await redis.set(key, value, ttlSeconds);
  }

  /**
   * Получить значение из кэша
   */
  async get<T>(key: string): Promise<T | null> {
    return await redis.get<T>(key);
  }

  /**
   * Удалить значение из кэша
   */
  async delete(key: string): Promise<void> {
    await redis.del(key);
  }

  /**
   * Очистить весь кэш
   */
  async clear(): Promise<void> {
    await redis.clear();
  }

  /**
   * Синхронная версия для обратной совместимости (использует await внутри)
   */
  setSync<T>(key: string, value: T, ttlSeconds: number = 300): void {
    this.set(key, value, ttlSeconds).catch(err => {
      logger.error(`Cache setSync error for key ${key}:`, err);
    });
  }

  getSync<T>(key: string): T | null {
    // Для синхронного доступа возвращаем null и логируем предупреждение
    logger.warn(`Cache getSync called for key ${key} - используйте async get() вместо этого`);
    return null;
  }

  deleteSync(key: string): void {
    this.delete(key).catch(err => {
      logger.error(`Cache deleteSync error for key ${key}:`, err);
    });
  }

  clearSync(): void {
    this.clear().catch(err => {
      logger.error('Cache clearSync error:', err);
    });
  }
}

export const cache = new Cache();

