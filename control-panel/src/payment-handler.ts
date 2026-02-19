/**
 * Обработчик платежей
 * Поддерживает YooMoney и Telegram Stars (опционально)
 */

import { queries } from './database';
import { SalesManager } from './sales-manager';
import { logger } from './logger';
import crypto from 'crypto';

const YOOMONEY_TOKEN = process.env.YOOMONEY_TOKEN || '';
const YOOMONEY_WALLET = process.env.YOOMONEY_WALLET || '';

// Ожидающие платежи
export const pendingPayments = new Map<string, {
  userId: number;
  productId: number;
  createdAt: number;
  chatId: number;
}>();

/**
 * Проверить платеж YooMoney
 */
export async function checkYooMoneyPayment(label: string): Promise<boolean> {
  if (!YOOMONEY_TOKEN) return false;

  try {
    const res = await fetch('https://yoomoney.ru/api/operation-history', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${YOOMONEY_TOKEN}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `type=deposition&label=${label}&records=1`,
    });

    const data = await res.json() as any;
    if (data.operations && data.operations.length > 0) {
      return data.operations[0].status === 'success';
    }
  } catch (err) {
    logger.error('YooMoney API error:', err);
  }
  return false;
}

/**
 * Создать ссылку на оплату YooMoney
 */
export function createYooMoneyPaymentLink(params: {
  userId: number;
  productId: number;
  amount: number;
}): { url: string; label: string } {
  const label = `pay_${params.userId}_${params.productId}_${crypto.randomBytes(4).toString('hex')}`;
  const url = `https://yoomoney.ru/quickpay/confirm?receiver=${YOOMONEY_WALLET}` +
    `&quickpay-form=button` +
    `&paymentType=AC` +
    `&sum=${params.amount}` +
    `&label=${label}` +
    `&successURL=https://t.me`;
  
  return { url, label };
}

/**
 * Активировать подписку после оплаты
 */
export async function activateAfterPayment(params: {
  userId: number;
  productId: number;
  chatId: number;
  paymentMethod: string;
  paymentId: string;
  amount: number;
}): Promise<{ success: boolean; links?: string[]; error?: string }> {
  const { userId, productId, chatId, paymentMethod, paymentId, amount } = params;

  const result = await SalesManager.createOrder({
    telegramId: userId,
    productId,
    paymentMethod,
    paymentId,
    amount,
  });

  return result;
}

/**
 * Поллинг для проверки ожидающих платежей
 */
export function startPaymentPolling(bot: any) {
  setInterval(async () => {
    if (pendingPayments.size === 0) return;
    const now = Date.now();

    for (const [label, pending] of pendingPayments) {
      // Удаляем старые платежи (старше 30 минут)
      if (now - pending.createdAt > 30 * 60 * 1000) {
        pendingPayments.delete(label);
        continue;
      }

      // Проверяем платеж
      const paid = await checkYooMoneyPayment(label);
      if (paid) {
        pendingPayments.delete(label);
        
        try {
          const { queries } = await import('./database');
          const product = queries.getProductById.get(pending.productId) as any;
          const amount = product?.price ?? 0;
          const result = await activateAfterPayment({
            userId: pending.userId,
            productId: pending.productId,
            chatId: pending.chatId,
            paymentMethod: 'yoomoney',
            paymentId: label,
            amount,
          });

          if (result.success && result.links) {
            await bot.telegram.sendMessage(
              pending.chatId,
              `✅ Оплата принята! Спасибо!\n\n` +
              `🔗 Ваши ссылки:\n${result.links.map(l => `\`${l}\``).join('\n')}\n\n` +
              `⚠️ Ссылки только для вас!`,
              { parse_mode: 'Markdown', disable_web_page_preview: true }
            );
          }
        } catch (err: any) {
          logger.error('Ошибка активации после оплаты:', err);
        }
      }
    }
  }, 15_000); // Проверка каждые 15 секунд
}

