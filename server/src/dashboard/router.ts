import { Router } from 'express';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/require-auth.js';

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get('/', async (req, res) => {
  const userId = req.userId!;
  const now = new Date();

  const [totalWords, dueCount, newCount, byStatus, notebooks] = await Promise.all([
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
  ]);

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
    statusCounts,
    recentNotebooks: notebooks.map((n) => ({
      id: n.id,
      title: n.title,
      emoji: n.emoji,
      wordCount: n._count.items,
    })),
  });
});
