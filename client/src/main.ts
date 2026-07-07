import { api, ApiError, type CurrentUser } from './api.js';
import { initRouter } from './router.js';
import { esc } from './util.js';
import { renderLogin } from './views/login.js';
import { renderNotebooks } from './views/notebooks.js';
import { renderNotebook } from './views/notebook.js';

const root = document.querySelector<HTMLDivElement>('#app')!;

function renderLayout(user: CurrentUser): HTMLElement {
  const name = user.firstName ?? user.username ?? 'пользователь';
  root.innerHTML = `
    <header class="topbar">
      <a class="logo" href="#/">LEXA</a>
      <div class="topbar-right">
        <span class="muted">${esc(name)}</span>
        <button class="btn btn-small" id="logout">Выйти</button>
      </div>
    </header>
    <div id="view" class="view"></div>
  `;
  root.querySelector<HTMLButtonElement>('#logout')!.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.hash = '#/';
    await start();
  });
  return root.querySelector<HTMLDivElement>('#view')!;
}

async function start(): Promise<void> {
  try {
    const user = await api<CurrentUser>('/api/auth/me');
    const view = renderLayout(user);
    initRouter(view, [
      { pattern: /^#\/$/, render: renderNotebooks },
      { pattern: /^#\/notebooks\/([\w-]+)$/, render: renderNotebook },
    ]);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await renderLogin(root, start);
    } else {
      root.innerHTML = `<main class="landing"><h1>LEXA</h1><p>Сервер недоступен</p></main>`;
    }
  }
}

void start();
