import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { logger } from '../logger.js';
import { chat } from './chat.js';
import { appendChatMessages, clearChatHistory, getChatHistory } from './history.js';

export const aiRouter = Router();

aiRouter.use(requireAuth);

aiRouter.get('/history', async (req, res) => {
  res.json(await getChatHistory(req.userId!, 50));
});

aiRouter.delete('/history', async (req, res) => {
  await clearChatHistory(req.userId!);
  res.json({ ok: true });
});

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
});

aiRouter.post('/chat', async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid chat request' });
    return;
  }
  const userId = req.userId!;
  const userMessage = parsed.data.message;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (payload: object): void => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const history = await getChatHistory(userId);
    let answer = '';
    await chat(userId, [...history, { role: 'user', content: userMessage }], (text) => {
      answer += text;
      send({ delta: text });
    });
    await appendChatMessages(userId, [
      { role: 'user', content: userMessage },
      { role: 'assistant', content: answer },
    ]);
    send({ done: true });
  } catch (err) {
    logger.error({ err }, 'AI chat error');
    send({ error: 'Ошибка AI, попробуйте ещё раз' });
  } finally {
    res.end();
  }
});
