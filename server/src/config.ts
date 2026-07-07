function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env variable: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  jwtSecret: required('JWT_SECRET'),
  telegramBotToken: required('TELEGRAM_BOT_TOKEN'),
  isDev: process.env.NODE_ENV !== 'production',
};
