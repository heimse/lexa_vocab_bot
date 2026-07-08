import { prisma } from '../db.js';
import { enqueueCardGeneration } from './queue.js';

/** Разбивает массовый ввод на нормализованные уникальные записи. */
export function parseEntries(text: string): string[] {
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

export interface ImportResult {
  created: number;
  linked: number;
  total: number;
}

/**
 * Импортирует записи в набор: существующие слова привязывает,
 * для новых создаёт PENDING-карточки и ставит их в AI-очередь.
 */
export async function importEntries(
  userId: string,
  notebookId: string,
  entries: string[],
): Promise<ImportResult> {
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
  return { created, linked, total: entries.length };
}
