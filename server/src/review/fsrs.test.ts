import { describe, expect, it } from 'vitest';
import { applyReview } from './fsrs.js';
import type { VocabularyItem } from '../generated/prisma/client.js';

const NOW = new Date('2026-07-01T10:00:00Z');

function makeItem(overrides: Partial<VocabularyItem> = {}): VocabularyItem {
  return {
    id: 'test',
    userId: 'user',
    text: 'destiny',
    language: 'en',
    translation: 'судьба',
    partOfSpeech: 'noun',
    explanation: null,
    examples: [],
    synonyms: [],
    antonyms: [],
    level: null,
    aiStatus: 'READY',
    aiError: null,
    status: 'NEW',
    due: NOW,
    stability: 0,
    difficulty: 0,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    lastReview: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as VocabularyItem;
}

describe('applyReview', () => {
  it('новая карточка после GOOD уходит в изучение с будущим due', () => {
    const { itemUpdate, reviewSnapshot } = applyReview(makeItem(), 'GOOD', NOW);
    expect(itemUpdate.reps).toBe(1);
    expect(itemUpdate.state).toBeGreaterThan(0);
    expect(itemUpdate.due.getTime()).toBeGreaterThan(NOW.getTime());
    expect(itemUpdate.status).not.toBe('NEW');
    expect(itemUpdate.lastReview).toEqual(NOW);
    expect(reviewSnapshot.rating).toBe('GOOD');
    expect(reviewSnapshot.due).toEqual(itemUpdate.due);
  });

  it('AGAIN на карточке в Review увеличивает lapses и возвращает в изучение', () => {
    const item = makeItem({
      state: 2,
      stability: 10,
      difficulty: 5,
      reps: 3,
      lastReview: new Date('2026-06-20T10:00:00Z'),
    });
    const { itemUpdate } = applyReview(item, 'AGAIN', NOW);
    expect(itemUpdate.lapses).toBe(1);
    expect(itemUpdate.status).toBe('LEARNING');
  });

  it('EASY на зрелой карточке даёт статус MASTERED при интервале от 60 дней', () => {
    const item = makeItem({
      state: 2,
      stability: 80,
      difficulty: 3,
      reps: 10,
      lastReview: new Date('2026-04-01T10:00:00Z'),
    });
    const { itemUpdate } = applyReview(item, 'EASY', NOW);
    expect(itemUpdate.scheduledDays).toBeGreaterThanOrEqual(60);
    expect(itemUpdate.status).toBe('MASTERED');
  });

  it('интервалы растут: EASY даёт более поздний due, чем HARD', () => {
    const item = makeItem({
      state: 2,
      stability: 5,
      difficulty: 5,
      reps: 2,
      lastReview: new Date('2026-06-25T10:00:00Z'),
    });
    const easy = applyReview(item, 'EASY', NOW);
    const hard = applyReview(item, 'HARD', NOW);
    expect(easy.itemUpdate.due.getTime()).toBeGreaterThan(hard.itemUpdate.due.getTime());
  });
});
