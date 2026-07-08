import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { getReviewQueue, submitReview } from './service.js';

export const reviewRouter = Router();

reviewRouter.use(requireAuth);

reviewRouter.get('/today', async (req, res) => {
  res.json(await getReviewQueue(req.userId!));
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

  const updated = await submitReview(req.userId!, parsed.data.itemId, parsed.data.rating);
  if (!updated) {
    res.status(404).json({ error: 'Word not found' });
    return;
  }

  res.json({
    id: updated.id,
    due: updated.due,
    state: updated.state,
    status: updated.status,
    reps: updated.reps,
  });
});
