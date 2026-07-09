// Модули сервера читают конфиг при импорте — даём тестам фиктивное окружение
process.env.JWT_SECRET ??= 'test-secret';
process.env.TELEGRAM_BOT_TOKEN ??= 'test-token';
process.env.OPENAI_API_KEY ??= 'test-key';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
