import { api, ApiError, type NotebookDetail, type NotebookWord } from '../api.js';
import { esc } from '../util.js';

const AI_STATUS_LABEL: Record<NotebookWord['aiStatus'], string> = {
  PENDING: '⏳ обработка',
  READY: '',
  FAILED: '⚠️ ошибка AI',
};

export async function renderNotebook(container: HTMLElement, params: string[]): Promise<void> {
  const id = params[0]!;
  let notebook: NotebookDetail;
  try {
    notebook = await api<NotebookDetail>(`/api/notebooks/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      container.innerHTML = `<p>Набор не найден. <a href="#/">К списку наборов</a></p>`;
      return;
    }
    throw err;
  }

  container.innerHTML = `
    <section class="page">
      <p><a href="#/">← Все наборы</a></p>
      <div class="page-header">
        <h2>${esc(notebook.emoji) || '📖'} ${esc(notebook.title)}</h2>
        <span class="muted">${notebook.items.length} слов</span>
      </div>
      ${notebook.description ? `<p class="muted">${esc(notebook.description)}</p>` : ''}
      <p class="muted">Массовое добавление слов появится на следующем этапе.</p>
      ${
        notebook.items.length === 0
          ? '<p class="muted">В наборе пока нет слов.</p>'
          : `
      <table class="word-table">
        <thead>
          <tr><th>Слово</th><th>Перевод</th><th>Часть речи</th><th>Уровень</th><th></th></tr>
        </thead>
        <tbody>
          ${notebook.items
            .map(
              (w) => `
            <tr>
              <td class="word-text">${esc(w.text)}</td>
              <td>${esc(w.translation) || '—'}</td>
              <td>${esc(w.partOfSpeech) || '—'}</td>
              <td>${esc(w.level) || '—'}</td>
              <td class="muted">${AI_STATUS_LABEL[w.aiStatus]}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>`
      }
    </section>
  `;
}
