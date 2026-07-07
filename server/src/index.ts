import express from 'express';
import { prisma } from './db.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(express.json());

app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', service: 'lexa-api', db: 'ok' });
  } catch {
    res.status(503).json({ status: 'error', service: 'lexa-api', db: 'unavailable' });
  }
});

app.listen(PORT, () => {
  console.log(`LEXA API listening on http://localhost:${PORT}`);
});
