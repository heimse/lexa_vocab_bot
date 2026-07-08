import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/require-auth.js';
import { applyReview } from './fsrs.js';

export const reviewRouter = Router();

reviewRouter.use(requireAuth);

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

reviewRouter.get('/today', async (req, res) => {
  const userId = req.userId!;
  const now = new Date();

  // Слова в процессе изучения, у которых подошло время повторения
  const due = await prisma.vocabularyItem.findMany({
    where: { userId, aiStatus: 'READY', state: { gt: 0 }, due: { lte: now } },
    orderBy: { due: 'asc' },
    take: DUE_LIMIT,
    select: cardSelect,
  });

  // Порция новых слов
  const fresh = await prisma.vocabularyItem.findMany({
    where: { userId, aiStatus: 'READY', state: 0 },
    orderBy: { createdAt: 'asc' },
    take: NEW_LIMIT,
    select: cardSelect,
  });

  res.json({ due, fresh, total: due.length + fresh.length });
});

const resultSchema = z.object({
  itemId: z.string().min(1),
  rating: z.enum(['AGAIN', 'HARD', 'GOOD', 'EASY']),
});

reviewRouter.post('/result', async (req, res) => {
  const parsed = resultSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid review result' });
    return;
  }
  const { itemId, rating } = parsed.data;

  const item = await prisma.vocabularyItem.findFirst({
    where: { id: itemId, userId: req.userId! },
  });
  if (!item) {
    res.status(404).json({ error: 'Word not found' });
    return;
  }

  const now = new Date();
  const { itemUpdate, reviewSnapshot } = applyReview(item, rating, now);

  const [updated] = await prisma.$transaction([
    prisma.vocabularyItem.update({ where: { id: item.id }, data: itemUpdate }),
    prisma.review.create({ data: { vocabularyItemId: item.id, ...reviewSnapshot } }),
  ]);

  res.json({
    id: updated.id,
    due: updated.due,
    state: updated.state,
    status: updated.status,
    reps: updated.reps,
  });
});
