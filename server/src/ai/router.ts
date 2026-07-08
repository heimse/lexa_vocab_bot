import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/require-auth.js';
import { chat } from './chat.js';

export const aiRouter = Router();

aiRouter.use(requireAuth);

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(40),
});

aiRouter.post('/chat', async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid chat request' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (payload: object): void => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    await chat(req.userId!, parsed.data.messages, (text) => send({ delta: text }));
    send({ done: true });
  } catch (err) {
    console.error('AI chat error:', err);
    send({ error: 'Ошибка AI, попробуйте ещё раз' });
  } finally {
    res.end();
  }
});
