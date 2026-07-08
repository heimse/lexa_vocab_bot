import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/require-auth.js';
import { toCsv, toTxt, streamPdf } from './export.js';

export const notebooksRouter = Router();

notebooksRouter.use(requireAuth);

const notebookInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  emoji: z.string().trim().max(8).optional(),
});

notebooksRouter.get('/', async (req, res) => {
  const notebooks = await prisma.notebook.findMany({
    where: { userId: req.userId! },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { items: true } } },
  });
  res.json(
    notebooks.map((n) => ({
      id: n.id,
      title: n.title,
      description: n.description,
      emoji: n.emoji,
      createdAt: n.createdAt,
      wordCount: n._count.items,
    })),
  );
});

notebooksRouter.post('/', async (req, res) => {
  const parsed = notebookInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid notebook data' });
    return;
  }
  const notebook = await prisma.notebook.create({
    data: { userId: req.userId!, ...parsed.data },
  });
  res.status(201).json(notebook);
});

notebooksRouter.get('/:id', async (req, res) => {
  const notebook = await prisma.notebook.findFirst({
    where: { id: req.params.id, userId: req.userId! },
    include: {
      items: {
        orderBy: { addedAt: 'desc' },
        include: { vocabularyItem: true },
      },
    },
  });
  if (!notebook) {
    res.status(404).json({ error: 'Notebook not found' });
    return;
  }
  res.json({
    id: notebook.id,
    title: notebook.title,
    description: notebook.description,
    emoji: notebook.emoji,
    createdAt: notebook.createdAt,
    items: notebook.items.map(({ vocabularyItem: item, addedAt }) => ({
      id: item.id,
      text: item.text,
      language: item.language,
      translation: item.translation,
      partOfSpeech: item.partOfSpeech,
      level: item.level,
      aiStatus: item.aiStatus,
      status: item.status,
      addedAt,
    })),
  });
});

notebooksRouter.get('/:id/export', async (req, res) => {
  const format = String(req.query.format ?? 'csv');
  if (!['csv', 'txt', 'pdf'].includes(format)) {
    res.status(400).json({ error: 'Unknown format, use csv, txt or pdf' });
    return;
  }

  const notebook = await prisma.notebook.findFirst({
    where: { id: req.params.id, userId: req.userId! },
    include: {
      items: {
        orderBy: { addedAt: 'asc' },
        include: { vocabularyItem: true },
      },
    },
  });
  if (!notebook) {
    res.status(404).json({ error: 'Notebook not found' });
    return;
  }

  const items = notebook.items.map(({ vocabularyItem: item }) => ({
    text: item.text,
    language: item.language,
    translation: item.translation,
    partOfSpeech: item.partOfSpeech,
    level: item.level,
    explanation: item.explanation,
    examples: item.examples,
    synonyms: item.synonyms,
    antonyms: item.antonyms,
  }));

  const safeName = notebook.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'notebook';
  const filename = encodeURIComponent(`${safeName}.${format}`);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="lexa.${format}"; filename*=UTF-8''${filename}`,
  );

  switch (format) {
    case 'csv':
      res.type('text/csv; charset=utf-8').send(toCsv(items));
      break;
    case 'txt':
      res.type('text/plain; charset=utf-8').send(toTxt(notebook.title, items));
      break;
    case 'pdf':
      res.type('application/pdf');
      streamPdf(res, notebook.title, items);
      break;
  }
});

notebooksRouter.patch('/:id', async (req, res) => {
  const parsed = notebookInputSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid notebook data' });
    return;
  }
  const { count } = await prisma.notebook.updateMany({
    where: { id: req.params.id, userId: req.userId! },
    data: parsed.data,
  });
  if (count === 0) {
    res.status(404).json({ error: 'Notebook not found' });
    return;
  }
  const notebook = await prisma.notebook.findUnique({ where: { id: req.params.id } });
  res.json(notebook);
});

notebooksRouter.delete('/:id', async (req, res) => {
  const { count } = await prisma.notebook.deleteMany({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (count === 0) {
    res.status(404).json({ error: 'Notebook not found' });
    return;
  }
  res.json({ ok: true });
});
