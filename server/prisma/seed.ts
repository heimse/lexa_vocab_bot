import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const user = await prisma.user.upsert({
    where: { telegramId: 1n },
    update: {},
    create: {
      telegramId: 1n,
      username: 'dev',
      firstName: 'Dev',
    },
  });

  const notebook = await prisma.notebook.upsert({
    where: { id: 'seed-notebook-witcher' },
    update: {},
    create: {
      id: 'seed-notebook-witcher',
      userId: user.id,
      title: 'Ведьмак',
      emoji: '📚',
      description: 'Слова из книг Анджея Сапковского',
    },
  });

  const readyWords = [
    {
      text: 'destiny',
      translation: 'судьба',
      partOfSpeech: 'noun',
      explanation: 'The events that will necessarily happen to a person in the future.',
      examples: ['Geralt never believed in destiny.', 'It was her destiny to become a queen.'],
      synonyms: ['fate', 'fortune', 'doom'],
      antonyms: ['choice', 'free will'],
      level: 'B1',
    },
    {
      text: 'curse',
      translation: 'проклятие',
      partOfSpeech: 'noun',
      explanation: 'A solemn utterance intended to invoke evil or harm on someone.',
      examples: ['The princess was under a curse.', 'He muttered a curse under his breath.'],
      synonyms: ['hex', 'jinx', 'spell'],
      antonyms: ['blessing'],
      level: 'B1',
    },
    {
      text: 'look forward to',
      translation: 'с нетерпением ждать',
      partOfSpeech: 'phrasal verb',
      explanation: 'To feel pleased and excited about something that is going to happen.',
      examples: ['I look forward to hearing from you.', 'She looks forward to the weekend.'],
      synonyms: ['anticipate', 'await'],
      antonyms: ['dread'],
      level: 'A2',
    },
  ] as const;

  for (const word of readyWords) {
    await prisma.vocabularyItem.upsert({
      where: { userId_text_language: { userId: user.id, text: word.text, language: 'en' } },
      update: {},
      create: {
        userId: user.id,
        text: word.text,
        language: 'en',
        aiStatus: 'READY',
        ...word,
        examples: [...word.examples],
        synonyms: [...word.synonyms],
        antonyms: [...word.antonyms],
        notebooks: { create: { notebookId: notebook.id } },
      },
    });
  }

  for (const text of ['monster', 'sorceress']) {
    await prisma.vocabularyItem.upsert({
      where: { userId_text_language: { userId: user.id, text, language: 'en' } },
      update: {},
      create: {
        userId: user.id,
        text,
        language: 'en',
        aiStatus: 'PENDING',
        notebooks: { create: { notebookId: notebook.id } },
      },
    });
  }

  const counts = {
    users: await prisma.user.count(),
    notebooks: await prisma.notebook.count(),
    vocabularyItems: await prisma.vocabularyItem.count(),
  };
  console.log('Seed done:', counts);
}

main().finally(() => prisma.$disconnect());
