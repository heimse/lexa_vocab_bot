import { fsrs, generatorParameters, Rating, State, type Card } from 'ts-fsrs';
import type { VocabularyItem, ReviewRating, LearningStatus } from '../generated/prisma/client.js';

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

export const RATING_MAP: Record<
  ReviewRating,
  Rating.Again | Rating.Hard | Rating.Good | Rating.Easy
> = {
  AGAIN: Rating.Again,
  HARD: Rating.Hard,
  GOOD: Rating.Good,
  EASY: Rating.Easy,
};

function toCard(item: VocabularyItem): Card {
  return {
    due: item.due,
    stability: item.stability,
    difficulty: item.difficulty,
    elapsed_days: item.elapsedDays,
    scheduled_days: item.scheduledDays,
    learning_steps: item.learningSteps,
    reps: item.reps,
    lapses: item.lapses,
    state: item.state as State,
    last_review: item.lastReview ?? undefined,
  };
}

/** Статус изучения для отображения, выводится из FSRS-состояния. */
function deriveStatus(card: Card): LearningStatus {
  switch (card.state) {
    case State.New:
      return 'NEW';
    case State.Learning:
    case State.Relearning:
      return 'LEARNING';
    case State.Review:
      // Считаем слово выученным, когда интервал повторения превысил ~2 месяца
      return card.scheduled_days >= 60 ? 'MASTERED' : 'REVIEW';
  }
}

export function applyReview(item: VocabularyItem, rating: ReviewRating, now: Date) {
  const { card } = scheduler.next(toCard(item), now, RATING_MAP[rating]);
  return {
    itemUpdate: {
      due: card.due,
      stability: card.stability,
      difficulty: card.difficulty,
      elapsedDays: card.elapsed_days,
      scheduledDays: card.scheduled_days,
      learningSteps: card.learning_steps,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state as number,
      lastReview: now,
      status: deriveStatus(card),
    },
    reviewSnapshot: {
      rating,
      reviewedAt: now,
      stability: card.stability,
      difficulty: card.difficulty,
      state: card.state as number,
      due: card.due,
    },
  };
}
