import express from 'express';
import cookieParser from 'cookie-parser';
import { prisma } from './db.js';
import { config } from './config.js';
import { authRouter } from './auth/router.js';
import { notebooksRouter } from './notebooks/router.js';
import { vocabularyRouter } from './vocabulary/router.js';
import { reviewRouter } from './review/router.js';
import { dashboardRouter } from './dashboard/router.js';
import { aiRouter } from './ai/router.js';
import { resumePendingCardGeneration } from './vocabulary/queue.js';

const app = express();
const PORT = config.port;

app.use(express.json());
app.use(cookieParser());

app.use('/api/auth', authRouter);
app.use('/api/notebooks', notebooksRouter);
app.use('/api/vocabulary', vocabularyRouter);
app.use('/api/review', reviewRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/ai', aiRouter);

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', service: 'lexa-api', db: 'ok' });
  } catch {
    res.status(503).json({ status: 'error', service: 'lexa-api', db: 'unavailable' });
  }
});

app.listen(PORT, () => {
  console.log(`LEXA API listening on http://localhost:${PORT}`);
  void resumePendingCardGeneration();
});
