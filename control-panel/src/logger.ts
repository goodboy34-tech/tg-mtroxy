/**
 * Профессиональная система логирования с ротацией файлов
 * Логи сохраняются в data/logs/ с автоматической ротацией
 */

import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';

const LOGS_DIR = path.join(__dirname, '..', 'data', 'logs');
fs.mkdirSync(LOGS_DIR, { recursive: true });

// Формат логов
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Формат для консоли (более читаемый)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(meta).length > 0) {
      msg += ` ${JSON.stringify(meta)}`;
    }
    return msg;
  })
);

// Транспорты
const transports: winston.transport[] = [
  // Консоль (все логи)
  new winston.transports.Console({
    format: consoleFormat,
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  }),

  // Файл для всех логов (ротация ежедневно, хранение 30 дней)
  new DailyRotateFile({
    filename: path.join(LOGS_DIR, 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '50m',
    maxFiles: '30d',
    format: logFormat,
    level: 'debug',
  }),

  // Файл только для ошибок (ротация ежедневно, хранение 90 дней)
  new DailyRotateFile({
    filename: path.join(LOGS_DIR, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '50m',
    maxFiles: '90d',
    format: logFormat,
    level: 'error',
  }),
];

// Создание логгера
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports,
  exceptionHandlers: [
    new DailyRotateFile({
      filename: path.join(LOGS_DIR, 'exceptions-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '50m',
      maxFiles: '30d',
    }),
  ],
  rejectionHandlers: [
    new DailyRotateFile({
      filename: path.join(LOGS_DIR, 'rejections-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '50m',
      maxFiles: '30d',
    }),
  ],
});

// Если не в продакшене, логируем в консоль
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: consoleFormat,
  }));
}

export default logger;

