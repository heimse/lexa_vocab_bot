import { prisma } from '../db.js';
import { applyReview } from './fsrs.js';
import type { ReviewRating } from '../generated/prisma/client.js';

const cardSelect = {
  id: true,
  text: true,
  language: true,
  translation: true,
  partOfSpeech: true,
  explanation: true,
  examples: true,
  synonyms: true,
  level: true,
  state: true,
  due: true,
} as const;

export type ReviewCard = Awaited<ReturnType<typeof getReviewQueue>>['due'][number];

export async function getReviewQueue(userId: string) {
  const now = new Date();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { dailyDueLimit: true, dailyNewLimit: true },
  });

  const due = await prisma.vocabularyItem.findMany({
    where: { userId, aiStatus: 'READY', state: { gt: 0 }, due: { lte: now } },
    orderBy: { due: 'asc' },
    take: user?.dailyDueLimit ?? 20,
    select: cardSelect,
  });

  const fresh = await prisma.vocabularyItem.findMany({
    where: { userId, aiStatus: 'READY', state: 0 },
    orderBy: { createdAt: 'asc' },
    take: user?.dailyNewLimit ?? 10,
    select: cardSelect,
  });

  return { due, fresh, total: due.length + fresh.length };
}

export async function countDue(userId: string): Promise<number> {
  return prisma.vocabularyItem.count({
    where: { userId, aiStatus: 'READY', state: { gt: 0 }, due: { lte: new Date() } },
  });
}

/** Стрик: сколько дней подряд (включая сегодня или вчера) было хотя бы одно повторение. */
export async function getStreak(userId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ d: Date }[]>`
    SELECT DISTINCT date(r.reviewed_at) AS d
    FROM reviews r
    JOIN vocabulary_items v ON v.id = r.vocabulary_item_id
    WHERE v.user_id = ${userId}
    ORDER BY d DESC
    LIMIT 400
  `;
  const days = new Set(rows.map((r) => new Date(r.d).toDateString()));

  const cursor = new Date();
  // Сегодня ещё можно успеть — стрик не сгорает до конца дня
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (days.has(cursor.toDateString())) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Прогноз: сколько повторений подойдёт в каждый из ближайших days дней. */
export async function getForecast(
  userId: string,
  days = 7,
): Promise<{ date: string; count: number }[]> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const result: { date: string; count: number }[] = [];

  for (let i = 0; i < days; i++) {
    const from = new Date(start);
    from.setDate(from.getDate() + i);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    const count = await prisma.vocabularyItem.count({
      where: {
        userId,
        aiStatus: 'READY',
        state: { gt: 0 },
        // Просроченные слова попадают в первый день
        due: i === 0 ? { lt: to } : { gte: from, lt: to },
      },
    });
    // Локальная дата, не UTC — иначе сдвиг на день в поясах восточнее Гринвича
    const date = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
    result.push({ date, count });
  }
  return result;
}

/** Применяет оценку; возвращает null, если слово не принадлежит пользователю. */
export async function submitReview(userId: string, itemId: string, rating: ReviewRating) {
  const item = await prisma.vocabularyItem.findFirst({ where: { id: itemId, userId } });
  if (!item) return null;

  const now = new Date();
  const { itemUpdate, reviewSnapshot } = applyReview(item, rating, now);

  const [updated] = await prisma.$transaction([
    prisma.vocabularyItem.update({ where: { id: item.id }, data: itemUpdate }),
    prisma.review.create({ data: { vocabularyItemId: item.id, ...reviewSnapshot } }),
  ]);

  return updated;
}
