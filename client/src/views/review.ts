import { api, type ReviewCard, type ReviewQueue } from '../api.js';
import { esc } from '../util.js';

type RatingKey = 'AGAIN' | 'HARD' | 'GOOD' | 'EASY';

const RATINGS: { key: RatingKey; label: string; className: string }[] = [
  { key: 'AGAIN', label: 'Не помню', className: 'rate-again' },
  { key: 'HARD', label: 'Трудно', className: 'rate-hard' },
  { key: 'GOOD', label: 'Хорошо', className: 'rate-good' },
  { key: 'EASY', label: 'Легко', className: 'rate-easy' },
];

export async function renderReview(container: HTMLElement): Promise<void> {
  const queue = await api<ReviewQueue>('/api/review/today');
  const cards: ReviewCard[] = [...queue.due, ...queue.fresh];

  if (cards.length === 0) {
    container.innerHTML = `
      <section class="page review-page">
        <h2>Повторение</h2>
        <p>🎉 На сегодня всё! Нет слов для повторения.</p>
        <p><a href="#/">На главную</a></p>
      </section>
    `;
    return;
  }

  let done = 0;
  const plannedTotal = cards.length;

  const showCard = (): void => {
    const card = cards.shift();
    if (!card) {
      container.innerHTML = `
        <section class="page review-page">
          <h2>Готово! 🎉</h2>
          <p>Повторено карточек: ${done}.</p>
          <p><a href="#/">На главную</a></p>
        </section>
      `;
      return;
    }

    const isNew = card.state === 0;
    container.innerHTML = `
      <section class="page review-page">
        <p class="muted">Карточка ${Math.min(done + 1, plannedTotal)} из ${plannedTotal}${
          isNew ? ' · новое слово' : ''
        }</p>
        <div class="review-card">
          <div class="review-word">${esc(card.text)}</div>
          <div id="answer" class="review-answer" hidden>
            <p class="review-translation">${esc(card.translation)}</p>
            ${card.explanation ? `<p class="muted">${esc(card.explanation)}</p>` : ''}
            ${
              card.examples.length > 0
                ? `<ul class="review-examples">${card.examples
                    .map((e) => `<li>${esc(e)}</li>`)
                    .join('')}</ul>`
                : ''
            }
            ${
              card.synonyms.length > 0
                ? `<p class="muted">Синонимы: ${esc(card.synonyms.join(', '))}</p>`
                : ''
            }
          </div>
        </div>
        <div class="review-controls" id="controls">
          <button class="btn btn-primary" id="show-answer">Показать ответ</button>
        </div>
      </section>
    `;

    const controls = container.querySelector<HTMLDivElement>('#controls')!;
    container.querySelector<HTMLButtonElement>('#show-answer')!.addEventListener('click', () => {
      container.querySelector<HTMLDivElement>('#answer')!.hidden = false;
      controls.innerHTML = RATINGS.map(
        (r) => `<button class="btn ${r.className}" data-rating="${r.key}">${r.label}</button>`,
      ).join('');
      controls.querySelectorAll<HTMLButtonElement>('[data-rating]').forEach((button) => {
        button.addEventListener('click', async () => {
          const rating = button.dataset.rating as RatingKey;
          controls.querySelectorAll('button').forEach((b) => (b.disabled = true));
          await api('/api/review/result', {
            method: 'POST',
            body: JSON.stringify({ itemId: card.id, rating }),
          });
          if (rating === 'AGAIN') {
            // Забытое слово вернётся в конце сессии
            cards.push(card);
          } else {
            done++;
          }
          showCard();
        });
      });
    });
  };

  showCard();
}
