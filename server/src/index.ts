import express from 'express';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'lexa-api' });
});

app.listen(PORT, () => {
  console.log(`LEXA API listening on http://localhost:${PORT}`);
});
