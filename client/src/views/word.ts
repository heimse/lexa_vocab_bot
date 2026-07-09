import { api, ApiError, type WordCard } from '../api.js';
import { esc } from '../util.js';

const POLL_INTERVAL = 2500;
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

export async function renderWord(container: HTMLElement, params: string[]): Promise<void> {
  const id = params[0]!;
  let word: WordCard;
  try {
    word = await api<WordCard>(`/api/vocabulary/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      container.innerHTML = `<p>Слово не найдено. <a href="#/">На главную</a></p>`;
      return;
    }
    throw err;
  }

  container.innerHTML = `
    <section class="page">
      <p><a href="javascript:history.back()">← Назад</a></p>
      <div class="page-header">
        <h2>${esc(word.text)} <button class="icon-btn" id="speak" title="Озвучить">🔊</button></h2>
        <span class="muted">${esc(word.language) || ''} ${esc(word.partOfSpeech) || ''}</span>
      </div>
      ${
        word.aiStatus === 'PENDING'
          ? '<p class="muted">⏳ AI заполняет карточку…</p>'
          : word.aiStatus === 'FAILED'
            ? `<p class="error">⚠️ Не удалось сгенерировать карточку${word.aiError ? `: ${esc(word.aiError)}` : ''}</p>`
            : ''
      }
      <form id="word-form" class="word-form">
        <label>Перевод
          <input name="translation" value="${esc(word.translation)}" maxlength="500" />
        </label>
        <label>Часть речи
          <input name="partOfSpeech" value="${esc(word.partOfSpeech)}" maxlength="50" />
        </label>
        <label>Уровень
          <select name="level">
            <option value="">—</option>
            ${LEVELS.map(
              (l) => `<option value="${l}" ${word.level === l ? 'selected' : ''}>${l}</option>`,
            ).join('')}
          </select>
        </label>
        <label>Объяснение
          <textarea name="explanation" rows="2" maxlength="2000">${esc(word.explanation)}</textarea>
        </label>
        <label>Примеры (по одному на строку)
          <textarea name="examples" rows="3">${esc(word.examples.join('\n'))}</textarea>
        </label>
        <label>Синонимы (через запятую)
          <input name="synonyms" value="${esc(word.synonyms.join(', '))}" />
        </label>
        <label>Антонимы (через запятую)
          <input name="antonyms" value="${esc(word.antonyms.join(', '))}" />
        </label>
        <div class="word-actions">
          <button type="submit" class="btn btn-primary">Сохранить</button>
          <button type="button" class="btn" id="regenerate">🔄 Перегенерировать</button>
          <button type="button" class="btn btn-danger" id="delete">Удалить</button>
          <span class="muted" id="word-status"></span>
        </div>
      </form>
      <p class="muted">Повторений: ${word.reps} · Следующее: ${new Date(word.due).toLocaleDateString('ru')} · Добавлено: ${new Date(word.createdAt).toLocaleDateString('ru')}</p>
    </section>
  `;

  container.querySelector<HTMLButtonElement>('#speak')!.addEventListener('click', () => {
    void new Audio(`/api/vocabulary/${id}/audio`).play();
  });

  const form = container.querySelector<HTMLFormElement>('#word-form')!;
  const status = container.querySelector<HTMLSpanElement>('#word-status')!;

  const splitList = (value: string): string[] =>
    value
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const payload: Record<string, unknown> = {};
    const translation = String(data.get('translation')).trim();
    const partOfSpeech = String(data.get('partOfSpeech')).trim();
    const explanation = String(data.get('explanation')).trim();
    const level = String(data.get('level'));
    if (translation) payload.translation = translation;
    if (partOfSpeech) payload.partOfSpeech = partOfSpeech;
    if (explanation) payload.explanation = explanation;
    if (level) payload.level = level;
    payload.examples = String(data.get('examples'))
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    payload.synonyms = splitList(String(data.get('synonyms')));
    payload.antonyms = splitList(String(data.get('antonyms')));
    try {
      await api(`/api/vocabulary/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      status.textContent = 'Сохранено ✓';
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Ошибка сохранения';
    }
  });

  container.querySelector<HTMLButtonElement>('#regenerate')!.addEventListener('click', async () => {
    await api(`/api/vocabulary/${id}/regenerate`, { method: 'POST' });
    await renderWord(container, params);
  });

  container.querySelector<HTMLButtonElement>('#delete')!.addEventListener('click', async () => {
    if (!confirm(`Удалить «${word.text}» из словаря вместе с историей повторений?`)) return;
    await api(`/api/vocabulary/${id}`, { method: 'DELETE' });
    location.hash = '#/';
  });

  if (word.aiStatus === 'PENDING') {
    setTimeout(() => {
      if (location.hash === `#/words/${id}` && container.isConnected) {
        void renderWord(container, params);
      }
    }, POLL_INTERVAL);
  }
}
