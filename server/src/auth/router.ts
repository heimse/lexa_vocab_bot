import { Router, type Response } from 'express';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { signToken } from './jwt.js';
import { telegramAuthSchema, verifyTelegramAuth, type TelegramAuthData } from './telegram.js';
import { AUTH_COOKIE, requireAuth } from '../middleware/require-auth.js';
import { createLoginNonce, takeConfirmedLogin } from './bot-login.js';

export const authRouter = Router();

const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

function setAuthCookie(res: Response, userId: string): void {
  res.cookie(AUTH_COOKIE, signToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: !config.isDev,
    maxAge: COOKIE_MAX_AGE,
  });
}

async function upsertTelegramUser(data: {
  telegramId: bigint;
  username?: string;
  firstName?: string;
  photoUrl?: string;
}) {
  return prisma.user.upsert({
    where: { telegramId: data.telegramId },
    update: {
      username: data.username ?? null,
      firstName: data.firstName ?? null,
      photoUrl: data.photoUrl ?? null,
    },
    create: {
      telegramId: data.telegramId,
      username: data.username,
      firstName: data.firstName,
      photoUrl: data.photoUrl,
    },
  });
}

// Данные от Telegram Login Widget
authRouter.post('/telegram', async (req, res) => {
  const parsed = telegramAuthSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid Telegram auth payload' });
    return;
  }
  const data: TelegramAuthData = parsed.data;

  if (!verifyTelegramAuth(data, config.telegramBotToken)) {
    res.status(401).json({ error: 'Telegram signature verification failed' });
    return;
  }

  const user = await upsertTelegramUser({
    telegramId: BigInt(data.id),
    username: data.username,
    firstName: data.first_name,
    photoUrl: data.photo_url,
  });

  setAuthCookie(res, user.id);
  res.json({ ok: true });
});

// Dev-вход без Telegram (виджет требует HTTPS-домен) — только вне production
if (config.isDev) {
  authRouter.post('/dev', async (_req, res) => {
    const user = await upsertTelegramUser({ telegramId: 1n, username: 'dev', firstName: 'Dev' });
    setAuthCookie(res, user.id);
    res.json({ ok: true });
  });
}

// Публичная конфигурация для страницы входа
let cachedBotUsername: string | null = null;

authRouter.get('/config', async (_req, res) => {
  if (cachedBotUsername === null) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/getMe`);
      const body = (await response.json()) as { ok: boolean; result?: { username?: string } };
      cachedBotUsername = body.ok ? (body.result?.username ?? null) : null;
    } catch {
      cachedBotUsername = null;
    }
  }
  res.json({ botUsername: cachedBotUsername, devMode: config.isDev });
});

// Вход через бота: сайт получает nonce и deep-link, бот подтверждает
authRouter.post('/bot-login/start', async (_req, res) => {
  let username = cachedBotUsername;
  if (!username) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/getMe`);
      const body = (await response.json()) as { ok: boolean; result?: { username?: string } };
      username = cachedBotUsername = body.ok ? (body.result?.username ?? null) : null;
    } catch {
      username = null;
    }
  }
  if (!username) {
    res.status(503).json({ error: 'Бот недоступен' });
    return;
  }
  const nonce = createLoginNonce();
  res.json({ nonce, url: `https://t.me/${username}?start=auth_${nonce}` });
});

authRouter.post('/bot-login/poll', (req, res) => {
  const nonce = String((req.body as { nonce?: string })?.nonce ?? '');
  const userId = nonce ? takeConfirmedLogin(nonce) : null;
  if (!userId) {
    res.json({ ok: false });
    return;
  }
  setAuthCookie(res, userId);
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.json({
    id: user.id,
    telegramId: String(user.telegramId),
    username: user.username,
    firstName: user.firstName,
    photoUrl: user.photoUrl,
  });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie(AUTH_COOKIE);
  res.json({ ok: true });
});
