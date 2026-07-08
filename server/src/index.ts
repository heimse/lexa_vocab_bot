import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { prisma } from './db.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { authRouter } from './auth/router.js';
import { notebooksRouter } from './notebooks/router.js';
import { vocabularyRouter } from './vocabulary/router.js';
import { reviewRouter } from './review/router.js';
import { dashboardRouter } from './dashboard/router.js';
import { aiRouter } from './ai/router.js';
import { settingsRouter } from './settings/router.js';
import { createBot, startDailyNotifications } from './telegram/bot.js';
import { resumePendingCardGeneration } from './vocabulary/queue.js';

const app = express();
const PORT = config.port;

app.use(express.json());
app.use(cookieParser());

// AI-эндпоинты дороже остальных — ограничиваем частоту per-IP
const aiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов, попробуйте позже' },
});

app.use('/api/auth', authRouter);
app.use('/api/notebooks', notebooksRouter);
app.use('/api/vocabulary', vocabularyRouter);
app.use('/api/review', reviewRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/ai', aiLimiter, aiRouter);
app.use('/api/settings', settingsRouter);

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', service: 'lexa-api', db: 'ok' });
  } catch {
    res.status(503).json({ status: 'error', service: 'lexa-api', db: 'unavailable' });
  }
});

// Глобальный обработчик ошибок (Express 5 ловит и rejected promises)
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err, method: req.method, url: req.url }, 'Unhandled request error');
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.listen(PORT, () => {
  logger.info(`LEXA API listening on http://localhost:${PORT}`);
  void resumePendingCardGeneration();

  // Telegram-бот: long polling (webhook — на этапе деплоя)
  const bot = createBot();
  bot
    .start({ onStart: (me) => logger.info(`Telegram bot @${me.username} started`) })
    .catch((err) => logger.error({ err }, 'Telegram bot failed to start'));
  startDailyNotifications(bot);
});
