import { prisma } from '../db.js';
import { applyReview } from './fsrs.js';
import type { ReviewRating } from '../generated/prisma/client.js';

const DUE_LIMIT = 20;
const NEW_LIMIT = 10;

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

  const due = await prisma.vocabularyItem.findMany({
    where: { userId, aiStatus: 'READY', state: { gt: 0 }, due: { lte: now } },
    orderBy: { due: 'asc' },
    take: DUE_LIMIT,
    select: cardSelect,
  });

  const fresh = await prisma.vocabularyItem.findMany({
    where: { userId, aiStatus: 'READY', state: 0 },
    orderBy: { createdAt: 'asc' },
    take: NEW_LIMIT,
    select: cardSelect,
  });

  return { due, fresh, total: due.length + fresh.length };
}

export async function countDue(userId: string): Promise<number> {
  return prisma.vocabularyItem.count({
    where: { userId, aiStatus: 'READY', state: { gt: 0 }, due: { lte: new Date() } },
  });
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
