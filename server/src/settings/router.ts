import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { AUTH_COOKIE, requireAuth } from '../middleware/require-auth.js';

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

export const SUPPORTED_NATIVE_LANGUAGES = [
  'ru',
  'en',
  'uk',
  'pl',
  'de',
  'es',
  'fr',
  'it',
  'pt',
] as const;

function toDto(user: {
  nativeLanguage: string;
  targetLanguage: string;
  dailyDueLimit: number;
  dailyNewLimit: number;
  notifyEnabled: boolean;
  notifyHour: number;
  username: string | null;
  firstName: string | null;
}) {
  return {
    username: user.username,
    firstName: user.firstName,
    nativeLanguage: user.nativeLanguage,
    targetLanguage: user.targetLanguage,
    dailyDueLimit: user.dailyDueLimit,
    dailyNewLimit: user.dailyNewLimit,
    notifyEnabled: user.notifyEnabled,
    notifyHour: user.notifyHour,
  };
}

settingsRouter.get('/', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.json(toDto(user));
});

const updateSchema = z.object({
  nativeLanguage: z.enum(SUPPORTED_NATIVE_LANGUAGES).optional(),
  targetLanguage: z.enum(SUPPORTED_NATIVE_LANGUAGES).optional(),
  dailyDueLimit: z.number().int().min(1).max(200).optional(),
  dailyNewLimit: z.number().int().min(0).max(100).optional(),
  notifyEnabled: z.boolean().optional(),
  notifyHour: z.number().int().min(0).max(23).optional(),
});

settingsRouter.patch('/', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid settings' });
    return;
  }
  const user = await prisma.user.update({ where: { id: req.userId! }, data: parsed.data });
  res.json(toDto(user));
});

// Полное удаление аккаунта и всех данных (каскадом: наборы, слова, история)
settingsRouter.delete('/account', async (req, res) => {
  await prisma.user.delete({ where: { id: req.userId! } });
  res.clearCookie(AUTH_COOKIE);
  res.json({ ok: true });
});
