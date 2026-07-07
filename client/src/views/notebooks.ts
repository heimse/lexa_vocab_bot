import { api, type Notebook } from '../api.js';
import { esc } from '../util.js';
import { renderCurrent } from '../router.js';

export async function renderNotebooks(container: HTMLElement): Promise<void> {
  const notebooks = await api<Notebook[]>('/api/notebooks');

  container.innerHTML = `
    <section class="page">
      <div class="page-header">
        <h2>Наборы</h2>
      </div>
      <form class="create-form" id="create-form">
        <input type="text" id="create-emoji" placeholder="📚" maxlength="8" />
        <input type="text" id="create-title" placeholder="Название набора" required maxlength="100" />
        <button type="submit" class="btn btn-primary">Создать</button>
      </form>
      <div class="cards" id="cards">
        ${
          notebooks.length === 0
            ? '<p class="muted">Пока нет ни одного набора. Создайте первый!</p>'
            : notebooks
                .map(
                  (n) => `
          <div class="card" data-id="${n.id}">
            <a class="card-body" href="#/notebooks/${n.id}">
              <span class="card-emoji">${esc(n.emoji) || '📖'}</span>
              <span class="card-title">${esc(n.title)}</span>
              <span class="card-meta">${n.wordCount} слов</span>
            </a>
            <div class="card-actions">
              <button class="icon-btn" data-action="rename" title="Переименовать">✏️</button>
              <button class="icon-btn" data-action="delete" title="Удалить">🗑️</button>
            </div>
          </div>`,
                )
                .join('')
        }
      </div>
    </section>
  `;

  container
    .querySelector<HTMLFormElement>('#create-form')!
    .addEventListener('submit', async (e) => {
      e.preventDefault();
      const title = container.querySelector<HTMLInputElement>('#create-title')!.value.trim();
      const emoji = container.querySelector<HTMLInputElement>('#create-emoji')!.value.trim();
      if (!title) return;
      await api('/api/notebooks', {
        method: 'POST',
        body: JSON.stringify({ title, emoji: emoji || undefined }),
      });
      await renderCurrent();
    });

  container.querySelector<HTMLDivElement>('#cards')!.addEventListener('click', async (e) => {
    const button = (e.target as HTMLElement).closest<HTMLButtonElement>('.icon-btn');
    if (!button) return;
    const card = button.closest<HTMLElement>('.card')!;
    const id = card.dataset.id!;
    const title = card.querySelector('.card-title')!.textContent ?? '';

    if (button.dataset.action === 'rename') {
      const newTitle = prompt('Новое название набора:', title)?.trim();
      if (!newTitle || newTitle === title) return;
      await api(`/api/notebooks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: newTitle }),
      });
      await renderCurrent();
    }

    if (button.dataset.action === 'delete') {
      if (!confirm(`Удалить набор «${title}»? Слова останутся в словаре.`)) return;
      await api(`/api/notebooks/${id}`, { method: 'DELETE' });
      await renderCurrent();
    }
  });
}
