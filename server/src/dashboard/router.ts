import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/require-auth.js';
import { getStreak, getForecast } from '../review/service.js';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const ACTIVITY_DAYS = 182; // ~26 недель

dashboardRouter.get('/activity', async (req, res) => {
  const userId = req.userId!;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (ACTIVITY_DAYS - 1));

  const [reviewRows, wordRows, baseline] = await Promise.all([
    prisma.$queryRaw<{ d: Date; n: bigint }[]>`
      SELECT date(r.reviewed_at) AS d, count(*) AS n
      FROM reviews r
      JOIN vocabulary_items v ON v.id = r.vocabulary_item_id
      WHERE v.user_id = ${userId} AND r.reviewed_at >= ${start}
      GROUP BY d
    `,
    prisma.$queryRaw<{ d: Date; n: bigint }[]>`
      SELECT date(created_at) AS d, count(*) AS n
      FROM vocabulary_items
      WHERE user_id = ${userId} AND created_at >= ${start}
      GROUP BY d
    `,
    prisma.vocabularyItem.count({ where: { userId, createdAt: { lt: start } } }),
  ]);

  const reviewsByDay = new Map(reviewRows.map((r) => [localDateKey(new Date(r.d)), Number(r.n)]));
  const wordsByDay = new Map(wordRows.map((r) => [localDateKey(new Date(r.d)), Number(r.n)]));

  const days: { date: string; reviews: number; totalWords: number }[] = [];
  let total = baseline;
  const cursor = new Date(start);
  for (let i = 0; i < ACTIVITY_DAYS; i++) {
    const key = localDateKey(cursor);
    total += wordsByDay.get(key) ?? 0;
    days.push({ date: key, reviews: reviewsByDay.get(key) ?? 0, totalWords: total });
    cursor.setDate(cursor.getDate() + 1);
  }

  res.json({ days });
});

dashboardRouter.get('/', async (req, res) => {
  const userId = req.userId!;
  const now = new Date();

  const [totalWords, dueCount, newCount, byStatus, notebooks, streak, forecast] = await Promise.all(
    [
      prisma.vocabularyItem.count({ where: { userId } }),
      prisma.vocabularyItem.count({
        where: { userId, aiStatus: 'READY', state: { gt: 0 }, due: { lte: now } },
      }),
      prisma.vocabularyItem.count({ where: { userId, aiStatus: 'READY', state: 0 } }),
      prisma.vocabularyItem.groupBy({
        by: ['status'],
        where: { userId },
        _count: { _all: true },
      }),
      prisma.notebook.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 6,
        include: { _count: { select: { items: true } } },
      }),
      getStreak(userId),
      getForecast(userId, 7),
    ],
  );

  const statusCounts: Record<string, number> = {
    NEW: 0,
    LEARNING: 0,
    REVIEW: 0,
    MASTERED: 0,
  };
  for (const group of byStatus) {
    statusCounts[group.status] = group._count._all;
  }

  res.json({
    totalWords,
    dueCount,
    newCount,
    streak,
    forecast,
    statusCounts,
    recentNotebooks: notebooks.map((n) => ({
      id: n.id,
      title: n.title,
      emoji: n.emoji,
      wordCount: n._count.items,
    })),
  });
});
