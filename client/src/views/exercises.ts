import { api } from '../api.js';
import { esc } from '../util.js';

interface ExercisePrompt {
  type: 'gap' | 'sentence';
  prompt: string;
}

interface ExerciseResult {
  correct: boolean;
  feedback: string;
}

export function renderExercises(container: HTMLElement): void {
  container.innerHTML = `
    <div class="exercises-page">
      <div class="exercise-pick" id="pick">
        <button class="btn" data-type="gap">✂️ Заполнить пропуск</button>
        <button class="btn" data-type="sentence">✍️ Составить предложение</button>
      </div>
      <div id="exercise-area" hidden>
        <p id="exercise-prompt" class="exercise-prompt"></p>
        <form id="exercise-form" class="chat-form">
          <input id="exercise-input" type="text" placeholder="Ваш ответ…" autocomplete="off" maxlength="1000" />
          <button type="submit" class="btn btn-primary">Проверить</button>
        </form>
        <p id="exercise-feedback" class="exercise-feedback"></p>
      </div>
    </div>
  `;

  const pick = container.querySelector<HTMLDivElement>('#pick')!;
  const area = container.querySelector<HTMLDivElement>('#exercise-area')!;
  const promptEl = container.querySelector<HTMLParagraphElement>('#exercise-prompt')!;
  const form = container.querySelector<HTMLFormElement>('#exercise-form')!;
  const input = container.querySelector<HTMLInputElement>('#exercise-input')!;
  const feedback = container.querySelector<HTMLParagraphElement>('#exercise-feedback')!;

  let currentType: ExercisePrompt['type'] = 'gap';

  const start = async (type: ExercisePrompt['type']): Promise<void> => {
    currentType = type;
    feedback.textContent = '';
    promptEl.textContent = 'Готовлю упражнение…';
    area.hidden = false;
    input.value = '';
    try {
      const exercise = await api<ExercisePrompt>('/api/ai/exercise', {
        method: 'POST',
        body: JSON.stringify({ type }),
      });
      promptEl.textContent = exercise.prompt;
      input.focus();
    } catch (err) {
      promptEl.textContent = err instanceof Error ? err.message : 'Ошибка';
    }
  };

  pick
    .querySelectorAll<HTMLButtonElement>('[data-type]')
    .forEach((button) =>
      button.addEventListener(
        'click',
        () => void start(button.dataset.type as ExercisePrompt['type']),
      ),
    );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const answer = input.value.trim();
    if (!answer) return;
    feedback.textContent = 'Проверяю…';
    feedback.className = 'exercise-feedback';
    try {
      const result = await api<ExerciseResult>('/api/ai/exercise/answer', {
        method: 'POST',
        body: JSON.stringify({ answer }),
      });
      feedback.innerHTML = `${result.correct ? '✅' : '❌'} ${esc(result.feedback)}
        <button class="btn btn-small" id="one-more">Ещё</button>`;
      feedback.classList.add(result.correct ? 'ok' : 'error');
      feedback
        .querySelector<HTMLButtonElement>('#one-more')!
        .addEventListener('click', () => void start(currentType));
    } catch (err) {
      feedback.textContent = err instanceof Error ? err.message : 'Ошибка проверки';
    }
  });
}
