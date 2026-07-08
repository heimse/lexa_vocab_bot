import { api } from '../api.js';
import { esc } from '../util.js';

interface SearchResult {
  id: string;
  text: string;
  language: string | null;
  translation: string | null;
  partOfSpeech: string | null;
  level: string | null;
  status: string;
  aiStatus: string;
}

export function renderSearch(container: HTMLElement): void {
  container.innerHTML = `
    <section class="page">
      <div class="page-header"><h2>Поиск по словарю</h2></div>
      <input id="search-input" class="search-input" type="search"
        placeholder="Слово или перевод — от 2 символов…" autocomplete="off" />
      <div id="search-results"><p class="muted">Ищет по всем наборам: и по слову, и по переводу.</p></div>
    </section>
  `;

  const input = container.querySelector<HTMLInputElement>('#search-input')!;
  const results = container.querySelector<HTMLDivElement>('#search-results')!;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastQuery = '';

  const search = async (): Promise<void> => {
    const query = input.value.trim();
    lastQuery = query;
    if (query.length < 2) {
      results.innerHTML = `<p class="muted">Введите минимум 2 символа.</p>`;
      return;
    }
    const items = await api<SearchResult[]>(
      `/api/vocabulary/search?q=${encodeURIComponent(query)}`,
    );
    if (lastQuery !== input.value.trim()) return; // пришёл устаревший ответ

    if (items.length === 0) {
      results.innerHTML = `<p class="muted">Ничего не найдено по «${esc(query)}».</p>`;
      return;
    }
    results.innerHTML = `
      <table class="word-table">
        <thead>
          <tr><th>Слово</th><th>Перевод</th><th>Часть речи</th><th>Уровень</th></tr>
        </thead>
        <tbody>
          ${items
            .map(
              (w) => `
            <tr>
              <td class="word-text"><a href="#/words/${w.id}">${esc(w.text)}</a></td>
              <td>${esc(w.translation) || '—'}</td>
              <td>${esc(w.partOfSpeech) || '—'}</td>
              <td>${esc(w.level) || '—'}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    `;
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void search(), 300);
  });

  input.focus();
}
