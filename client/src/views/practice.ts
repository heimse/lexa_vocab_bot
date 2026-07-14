import { renderReview } from './review.js';
import { renderExercises } from './exercises.js';

type PracticeMode = 'review' | 'exercises';

const TABS: { mode: PracticeMode; href: string; label: string }[] = [
  { mode: 'review', href: '#/practice', label: '🔁 Повторение' },
  { mode: 'exercises', href: '#/practice/exercises', label: '🎯 Упражнения' },
];

export async function renderPractice(container: HTMLElement, params: string[]): Promise<void> {
  const mode: PracticeMode = params[0] === 'exercises' ? 'exercises' : 'review';

  container.innerHTML = `
    <section class="page">
      <div class="practice-tabs">
        ${TABS.map(
          (t) =>
            `<a href="${t.href}" class="practice-tab${t.mode === mode ? ' active' : ''}">${t.label}</a>`,
        ).join('')}
      </div>
      <div id="practice-body"></div>
    </section>
  `;

  const body = container.querySelector<HTMLDivElement>('#practice-body')!;
  if (mode === 'review') {
    await renderReview(body);
  } else {
    renderExercises(body);
  }
}
