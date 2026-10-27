# LEXA — AI Vocabulary

> Not just a dictionary. A personal memory for foreign words.

Specification: [SPEC.md](SPEC.md). Development plan: [PLAN.md](PLAN.md).

## Stack

- **Backend:** TypeScript, Express, Prisma, PostgreSQL, grammY, OpenAI SDK
- **Frontend:** Vite + vanilla TypeScript (no frameworks)

## Structure

```
client/   — frontend (Vite)
server/   — API, Telegram bot, AI (Express)
```

## Running locally

Requirements: Node 22 (pinned via [Volta](https://volta.sh)), Docker.

```bash
# 1. Install dependencies
npm install

# 2. Start PostgreSQL
docker compose up -d

# 3. Configure the environment
cp server/.env.example server/.env
# fill in TELEGRAM_BOT_TOKEN and OPENAI_API_KEY

# 4. Run (API on :3000, frontend on :5173)
npm run dev
```

The frontend proxies `/api/*` to the server (see `client/vite.config.ts`).
