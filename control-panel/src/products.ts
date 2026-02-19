/**
 * Управление тарифами (продуктами) для продажи MTProxy
 * Адаптировано из бота продаж от AndreyOsipuk
 */

export interface Product {
  id?: number;
  name: string;
  emoji: string;
  price: number;        // цена в рублях (0 = бесплатно)
  days: number;         // дни (0 = минуты, см. minutes)
  minutes?: number;     // для trial — длительность в минутах
  maxConnections: number;
  description: string;
  isTrial: boolean;
  nodeCount: number;    // количество нод для выдачи (для повышения стабильности)
}

export const DEFAULT_PRODUCTS: Product[] = [
  {
    name: '30 минут',
    emoji: '🆓',
    price: 0,
    days: 0,
    minutes: 30,
    maxConnections: 1,
    description: 'Бесплатно • время уменьшается',
    isTrial: true,
    nodeCount: 1,
  },
  {
    name: '1 день',
    emoji: '⚡',
    price: 15,
    days: 1,
    maxConnections: 1,
    description: '15 ₽',
    isTrial: false,
    nodeCount: 1,
  },
  {
    name: '7 дней',
    emoji: '🔵',
    price: 50,
    days: 7,
    maxConnections: 1,
    description: '50 ₽',
    isTrial: false,
    nodeCount: 2, // 2 ноды для стабильности
  },
  {
    name: '30 дней',
    emoji: '🟣',
    price: 100,
    days: 30,
    maxConnections: 1,
    description: '100 ₽ (выгодно!)',
    isTrial: false,
    nodeCount: 3, // 3 ноды для максимальной стабильности
  },
];

export function formatProductList(products: Product[]): string {
  return products
    .map((p) => {
      const price = p.price === 0 ? 'БЕСПЛАТНО' : `${p.price} ₽`;
      const nodes = p.nodeCount > 1 ? ` (${p.nodeCount} ноды)` : '';
      return `${p.emoji} ${p.name} — ${price}${nodes}`;
    })
    .join('\n');
}

export function getProductById(products: Product[], id: number): Product | undefined {
  return products.find(p => p.id === id);
}

