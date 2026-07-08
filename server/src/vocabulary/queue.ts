import { prisma } from '../db.js';
import { generateCard } from '../ai/cards.js';
import { logger } from '../logger.js';

const MAX_ATTEMPTS = 3;

const queue: string[] = [];
let running = false;

export function enqueueCardGeneration(itemIds: string[]): void {
  for (const id of itemIds) {
    if (!queue.includes(id)) queue.push(id);
  }
  void run();
}

/** При старте сервера дообрабатываем всё, что осталось PENDING. */
export async function resumePendingCardGeneration(): Promise<void> {
  const pending = await prisma.vocabularyItem.findMany({
    where: { aiStatus: 'PENDING' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  if (pending.length > 0) {
    logger.info(`AI queue: resuming ${pending.length} pending item(s)`);
    enqueueCardGeneration(pending.map((p) => p.id));
  }
}

async function run(): Promise<void> {
  if (running) return;
  running = true;
  try {
    let id: string | undefined;
    while ((id = queue.shift()) !== undefined) {
      await processItem(id);
    }
  } finally {
    running = false;
  }
}

async function processItem(id: string): Promise<void> {
  const item = await prisma.vocabularyItem.findUnique({
    where: { id },
    include: { user: { select: { nativeLanguage: true } } },
  });
  if (!item || item.aiStatus === 'READY') return;

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const card = await generateCard(item.text, item.user.nativeLanguage);
      await prisma.vocabularyItem.update({
        where: { id },
        data: {
          language: card.language,
          partOfSpeech: card.part_of_speech,
          translation: card.translation,
          explanation: card.explanation,
          examples: card.examples,
          synonyms: card.synonyms,
          antonyms: card.antonyms,
          level: card.level,
          aiStatus: 'READY',
          aiError: null,
        },
      });
      return;
    } catch (err) {
      lastError = err;
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  logger.error(`AI queue: failed to generate card for "${item.text}": ${message}`);
  await prisma.vocabularyItem.update({
    where: { id },
    data: { aiStatus: 'FAILED', aiError: message.slice(0, 500) },
  });
}
