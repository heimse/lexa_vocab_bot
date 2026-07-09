import { randomBytes } from 'node:crypto';

/**
 * Вход на сайт через бота (для прода без домена, где Login Widget недоступен):
 * сайт получает одноразовый nonce и ссылку t.me/...?start=auth_<nonce>,
 * бот при /start с этим payload подтверждает вход, сайт забирает сессию поллингом.
 */

const TTL_MS = 10 * 60 * 1000;

interface PendingLogin {
  createdAt: number;
  userId: string | null;
}

const pending = new Map<string, PendingLogin>();

function cleanup(): void {
  const now = Date.now();
  for (const [nonce, entry] of pending) {
    if (now - entry.createdAt > TTL_MS) pending.delete(nonce);
  }
}

export function createLoginNonce(): string {
  cleanup();
  const nonce = randomBytes(16).toString('hex');
  pending.set(nonce, { createdAt: Date.now(), userId: null });
  return nonce;
}

/** Бот подтверждает вход. Возвращает false, если nonce неизвестен или протух. */
export function confirmLogin(nonce: string, userId: string): boolean {
  cleanup();
  const entry = pending.get(nonce);
  if (!entry) return false;
  entry.userId = userId;
  return true;
}

/** Сайт забирает подтверждённый вход; nonce одноразовый. */
export function takeConfirmedLogin(nonce: string): string | null {
  cleanup();
  const entry = pending.get(nonce);
  if (!entry?.userId) return null;
  pending.delete(nonce);
  return entry.userId;
}
