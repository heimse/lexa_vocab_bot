import {
  api,
  ApiError,
  type ImportResult,
  type NotebookDetail,
  type NotebookWord,
} from '../api.js';
import { esc } from '../util.js';

const AI_STATUS_LABEL: Record<NotebookWord['aiStatus'], string> = {
  PENDING: '⏳ обработка',
  READY: '',
  FAILED: '⚠️ ошибка AI',
};

const POLL_INTERVAL = 2500;

export async function renderNotebook(container: HTMLElement, params: string[]): Promise<void> {
  const id = params[0]!;
  let notebook: NotebookDetail;
  try {
    notebook = await api<NotebookDetail>(`/api/notebooks/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      container.innerHTML = `<p>Набор не найден. <a href="#/notebooks">К списку наборов</a></p>`;
      return;
    }
    throw err;
  }

  // Сохраняем черновик ввода между перерисовками (поллинг)
  const draft = container.querySelector<HTMLTextAreaElement>('#import-text')?.value ?? '';

  const pendingCount = notebook.items.filter((w) => w.aiStatus === 'PENDING').length;

  container.innerHTML = `
    <section class="page">
      <p><a href="#/notebooks">← Все наборы</a></p>
      <div class="page-header">
        <h2>${esc(notebook.emoji) || '📖'} ${esc(notebook.title)}</h2>
        <span class="muted">${notebook.items.length} слов</span>
      </div>
      ${notebook.description ? `<p class="muted">${esc(notebook.description)}</p>` : ''}
      ${
        notebook.items.length > 0
          ? `<p class="muted">Экспорт:
              <a href="/api/notebooks/${notebook.id}/export?format=csv">CSV</a> ·
              <a href="/api/notebooks/${notebook.id}/export?format=txt">TXT</a> ·
              <a href="/api/notebooks/${notebook.id}/export?format=pdf">PDF</a></p>`
          : ''
      }
      <form id="import-form" class="import-form">
        <textarea id="import-text" rows="5"
          placeholder="Вставьте слова или фразы — по одному на строку:&#10;&#10;destiny&#10;look forward to&#10;by the way"></textarea>
        <div class="import-actions">
          <button type="submit" class="btn btn-primary">Обработать</button>
          <span class="muted" id="import-status">${
            pendingCount > 0 ? `⏳ AI обрабатывает ${pendingCount} слов…` : ''
          }</span>
        </div>
      </form>
      ${
        notebook.items.length === 0
          ? '<p class="muted">В наборе пока нет слов.</p>'
          : `
      <input id="filter-input" class="search-input" type="search"
        placeholder="Фильтр по слову или переводу…" autocomplete="off" />
      <table class="word-table">
        <thead>
          <tr><th>Слово</th><th>Перевод</th><th>Часть речи</th><th>Уровень</th><th></th></tr>
        </thead>
        <tbody>
          ${notebook.items
            .map(
              (w) => `
            <tr data-search="${esc(`${w.text} ${w.translation ?? ''}`.toLowerCase())}">
              <td class="word-text"><a href="#/words/${w.id}">${esc(w.text)}</a></td>
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

  const textarea = container.querySelector<HTMLTextAreaElement>('#import-text')!;
  textarea.value = draft;

  const filterInput = container.querySelector<HTMLInputElement>('#filter-input');
  filterInput?.addEventListener('input', () => {
    const query = filterInput.value.trim().toLowerCase();
    container.querySelectorAll<HTMLTableRowElement>('tr[data-search]').forEach((row) => {
      row.hidden = query !== '' && !row.dataset.search!.includes(query);
    });
  });

  container
    .querySelector<HTMLFormElement>('#import-form')!
    .addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = textarea.value.trim();
      if (!text) return;
      const status = container.querySelector<HTMLSpanElement>('#import-status')!;
      status.textContent = 'Отправка…';
      try {
        const result = await api<ImportResult>('/api/vocabulary/import', {
          method: 'POST',
          body: JSON.stringify({ notebookId: id, text }),
        });
        textarea.value = '';
        status.textContent = `Добавлено новых: ${result.created}, уже были в словаре: ${result.linked}`;
        await renderNotebook(container, params);
      } catch (err) {
        status.textContent = err instanceof Error ? err.message : 'Ошибка импорта';
      }
    });

  if (pendingCount > 0) {
    setTimeout(() => {
      if (location.hash === `#/notebooks/${id}` && container.isConnected) {
        void renderNotebook(container, params);
      }
    }, POLL_INTERVAL);
  }
}
