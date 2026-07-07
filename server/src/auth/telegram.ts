import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const telegramAuthSchema = z.object({
  id: z.coerce.number().int().positive(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.coerce.number().int().positive(),
  hash: z.string().min(1),
});

export type TelegramAuthData = z.infer<typeof telegramAuthSchema>;

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

/**
 * Проверка подписи данных Telegram Login Widget:
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramAuth(data: TelegramAuthData, botToken: string): boolean {
  const { hash, ...fields } = data;

  const checkString = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secretKey = createHash('sha256').update(botToken).digest();
  const expected = createHmac('sha256', secretKey).update(checkString).digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(hash, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  if (!timingSafeEqual(expectedBuf, actualBuf)) return false;

  const ageSeconds = Date.now() / 1000 - data.auth_date;
  return ageSeconds >= 0 && ageSeconds <= MAX_AUTH_AGE_SECONDS;
}
