import OpenAI from 'openai';
import { z } from 'zod';
import { prisma } from '../db.js';
import { config } from '../config.js';
import { LANGUAGE_NAMES } from './cards.js';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

export type ExerciseType = 'gap' | 'sentence';

export interface Exercise {
  type: ExerciseType;
  wordId: string;
  word: string;
  translation: string | null;
  /** Текст задания для пользователя */
  prompt: string;
  /** Правильный ответ (для gap) */
  answer?: string;
}

interface ExerciseWord {
  id: string;
  text: string;
  translation: string | null;
  language: string | null;
}

/** Слово для упражнения: приоритет изучаемым, иначе любое готовое. */
async function pickWord(userId: string): Promise<ExerciseWord | null> {
  const candidates = await prisma.vocabularyItem.findMany({
    where: { userId, aiStatus: 'READY' },
    select: { id: true, text: true, translation: true, language: true, state: true },
  });
  if (candidates.length === 0) return null;
  const learning = candidates.filter((c) => c.state > 0);
  const pool = learning.length > 0 ? learning : candidates;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

const gapSchema = z.object({
  sentence_with_gap: z.string().min(1),
  answer: z.string().min(1),
});

const checkSchema = z.object({
  correct: z.boolean(),
  feedback: z.string().min(1),
});

export async function createExercise(userId: string, type: ExerciseType): Promise<Exercise | null> {
  const word = await pickWord(userId);
  if (!word) return null;

  if (type === 'sentence') {
    return {
      type,
      wordId: word.id,
      word: word.text,
      translation: word.translation,
      prompt:
        `Составьте предложение со словом «${word.text}»` +
        (word.translation ? ` (${word.translation})` : ''),
    };
  }

  const response = await openai.chat.completions.create({
    model: config.openaiModel,
    messages: [
      {
        role: 'system',
        content: `You create fill-in-the-blank exercises for language learners.
Write one natural sentence in ${LANGUAGE_NAMES[word.language ?? 'en'] ?? 'English'} that uses the given word or phrase.
Replace that word (in whatever grammatical form you used) with "___".
Return the sentence and the exact missing form as the answer.
The sentence must make the answer guessable from context.`,
      },
      { role: 'user', content: word.text },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'gap_exercise',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sentence_with_gap: { type: 'string' },
            answer: { type: 'string' },
          },
          required: ['sentence_with_gap', 'answer'],
        },
      },
    },
  });
  const gap = gapSchema.parse(JSON.parse(response.choices[0]?.message.content ?? '{}'));

  return {
    type,
    wordId: word.id,
    word: word.text,
    translation: word.translation,
    prompt:
      `Заполните пропуск:\n\n${gap.sentence_with_gap}` +
      (word.translation ? `\n\nПодсказка: ${word.translation}` : ''),
    answer: gap.answer,
  };
}

export interface ExerciseResult {
  correct: boolean;
  feedback: string;
}

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export async function checkExercise(
  exercise: Exercise,
  userAnswer: string,
): Promise<ExerciseResult> {
  if (exercise.type === 'gap') {
    const answer = normalize(userAnswer);
    const correct =
      answer === normalize(exercise.answer ?? '') || answer === normalize(exercise.word);
    return {
      correct,
      feedback: correct
        ? `Верно! ✅ ${exercise.answer}`
        : `Не совсем. Правильный ответ: ${exercise.answer}`,
    };
  }

  const response = await openai.chat.completions.create({
    model: config.openaiModel,
    messages: [
      {
        role: 'system',
        content: `Ты проверяешь упражнение по иностранному языку. Ученик должен был составить
предложение со словом «${exercise.word}». Оцени: слово использовано и предложение грамматически
корректно? Дай короткий фидбек на русском (1-2 предложения). Если есть ошибки — покажи
исправленный вариант. Будь доброжелателен.`,
      },
      { role: 'user', content: userAnswer },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'exercise_check',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            correct: { type: 'boolean' },
            feedback: { type: 'string' },
          },
          required: ['correct', 'feedback'],
        },
      },
    },
  });
  return checkSchema.parse(JSON.parse(response.choices[0]?.message.content ?? '{}'));
}
