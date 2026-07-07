import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/require-auth.js';
import { enqueueCardGeneration } from './queue.js';

export const vocabularyRouter = Router();

vocabularyRouter.use(requireAuth);

const importSchema = z.object({
  notebookId: z.string().min(1),
  text: z.string().min(1).max(20000),
});

/** Разбивает массовый ввод на нормализованные уникальные записи. */
function parseEntries(text: string): string[] {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const line of text.split('\n')) {
    const entry = line.trim().replace(/\s+/g, ' ');
    if (!entry) continue;
    const key = entry.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return entries;
}

vocabularyRouter.post('/import', async (req, res) => {
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid import data' });
    return;
  }
  const { notebookId, text } = parsed.data;
  const userId = req.userId!;

  const notebook = await prisma.notebook.findFirst({ where: { id: notebookId, userId } });
  if (!notebook) {
    res.status(404).json({ error: 'Notebook not found' });
    return;
  }

  const entries = parseEntries(text);
  if (entries.length === 0) {
    res.status(400).json({ error: 'No entries found in text' });
    return;
  }
  if (entries.length > 200) {
    res.status(400).json({ error: 'Too many entries, limit is 200 per import' });
    return;
  }

  let created = 0;
  let linked = 0;
  const newItemIds: string[] = [];

  for (const entry of entries) {
    const existing = await prisma.vocabularyItem.findFirst({
      where: { userId, text: { equals: entry, mode: 'insensitive' } },
    });

    const item =
      existing ??
      (await prisma.vocabularyItem.create({
        data: { userId, text: entry, aiStatus: 'PENDING' },
      }));

    if (existing) {
      linked++;
    } else {
      created++;
      newItemIds.push(item.id);
    }

    await prisma.notebookItem.upsert({
      where: {
        notebookId_vocabularyItemId: { notebookId, vocabularyItemId: item.id },
      },
      update: {},
      create: { notebookId, vocabularyItemId: item.id },
    });
  }

  enqueueCardGeneration(newItemIds);
  res.status(201).json({ created, linked, total: entries.length });
});

function toCardDto(item: {
  id: string;
  text: string;
  language: string | null;
  translation: string | null;
  partOfSpeech: string | null;
  explanation: string | null;
  examples: string[];
  synonyms: string[];
  antonyms: string[];
  level: string | null;
  aiStatus: string;
  aiError: string | null;
  status: string;
  due: Date;
  lastReview: Date | null;
  reps: number;
  createdAt: Date;
}) {
  return {
    id: item.id,
    text: item.text,
    language: item.language,
    translation: item.translation,
    partOfSpeech: item.partOfSpeech,
    explanation: item.explanation,
    examples: item.examples,
    synonyms: item.synonyms,
    antonyms: item.antonyms,
    level: item.level,
    aiStatus: item.aiStatus,
    aiError: item.aiError,
    status: item.status,
    due: item.due,
    lastReview: item.lastReview,
    reps: item.reps,
    createdAt: item.createdAt,
  };
}

vocabularyRouter.get('/:id', async (req, res) => {
  const item = await prisma.vocabularyItem.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!item) {
    res.status(404).json({ error: 'Word not found' });
    return;
  }
  res.json(toCardDto(item));
});

const updateSchema = z.object({
  translation: z.string().trim().min(1).max(500).optional(),
  partOfSpeech: z.string().trim().min(1).max(50).optional(),
  explanation: z.string().trim().min(1).max(2000).optional(),
  examples: z.array(z.string().trim().min(1).max(500)).max(10).optional(),
  synonyms: z.array(z.string().trim().min(1).max(100)).max(10).optional(),
  antonyms: z.array(z.string().trim().min(1).max(100)).max(10).optional(),
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional(),
});

vocabularyRouter.patch('/:id', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid word data' });
    return;
  }
  const { count } = await prisma.vocabularyItem.updateMany({
    where: { id: req.params.id, userId: req.userId! },
    data: parsed.data,
  });
  if (count === 0) {
    res.status(404).json({ error: 'Word not found' });
    return;
  }
  const item = await prisma.vocabularyItem.findUnique({ where: { id: req.params.id } });
  res.json(toCardDto(item!));
});

vocabularyRouter.delete('/:id', async (req, res) => {
  const { count } = await prisma.vocabularyItem.deleteMany({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (count === 0) {
    res.status(404).json({ error: 'Word not found' });
    return;
  }
  res.json({ ok: true });
});

vocabularyRouter.post('/:id/regenerate', async (req, res) => {
  const { count } = await prisma.vocabularyItem.updateMany({
    where: { id: req.params.id, userId: req.userId! },
    data: { aiStatus: 'PENDING', aiError: null },
  });
  if (count === 0) {
    res.status(404).json({ error: 'Word not found' });
    return;
  }
  enqueueCardGeneration([req.params.id!]);
  res.json({ ok: true });
});
