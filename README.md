# LEXA — AI Vocabulary

> Не просто словарь. Личная память для иностранных слов.

Спецификация — [SPEC.md](SPEC.md), план разработки — [PLAN.md](PLAN.md).

## Стек

- **Backend:** TypeScript, Express, Prisma, PostgreSQL, grammY, OpenAI SDK
- **Frontend:** Vite + vanilla TypeScript (без фреймворков)

## Структура

```
client/   — фронтенд (Vite)
server/   — API, Telegram-бот, AI (Express)
```

## Запуск для разработки

Требования: Node 22 (закреплён через [Volta](https://volta.sh)), Docker.

```bash
# 1. Установить зависимости
npm install

# 2. Поднять PostgreSQL
docker compose up -d

# 3. Настроить окружение
cp server/.env.example server/.env
# заполнить TELEGRAM_BOT_TOKEN и OPENAI_API_KEY

# 4. Запустить (API на :3000, фронт на :5173)
npm run dev
```

Фронтенд проксирует `/api/*` на сервер (см. `client/vite.config.ts`).
