function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env variable: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: required('JWT_SECRET'),
  telegramBotToken: required('TELEGRAM_BOT_TOKEN'),
  openaiApiKey: required('OPENAI_API_KEY'),
  openaiModel: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  openaiChatModel: process.env.OPENAI_CHAT_MODEL ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  isDev: process.env.NODE_ENV !== 'production',
  // Secure-куки браузер принимает только по HTTPS. Прод пока на HTTP (голый IP),
  // поэтому флаг управляется отдельно: COOKIE_SECURE=1 — включить.
  cookieSecure: process.env.COOKIE_SECURE === '1',
  // Если задан URL — бот работает через webhook, иначе long polling
  telegramWebhookUrl: process.env.TELEGRAM_WEBHOOK_URL || null,
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || null,
  telegramWebhookCert: process.env.TELEGRAM_WEBHOOK_CERT || null,
};
