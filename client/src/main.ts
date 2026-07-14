import { api, ApiError, type CurrentUser } from './api.js';
import { initRouter } from './router.js';
import { esc } from './util.js';
import { renderLogin } from './views/login.js';
import { renderNotebooks } from './views/notebooks.js';
import { renderNotebook } from './views/notebook.js';
import { renderWord } from './views/word.js';
import { renderDashboard } from './views/dashboard.js';
import { renderChat } from './views/chat.js';
import { renderSettings } from './views/settings.js';
import { renderSearch } from './views/search.js';
import { renderPractice } from './views/practice.js';

const root = document.querySelector<HTMLDivElement>('#app')!;

function renderLayout(user: CurrentUser): HTMLElement {
  const name = user.firstName ?? user.username ?? 'пользователь';
  root.innerHTML = `
    <header class="topbar">
      <nav class="topbar-nav">
        <a class="logo" href="#/">LEXA</a>
        <a href="#/search" class="icon-btn" title="Поиск">🔍</a>
        <a href="#/notebooks">Наборы</a>
        <a href="#/practice">Практика</a>
        <a href="#/chat">AI Chat</a>
      </nav>
      <div class="topbar-right">
        <div class="user-menu" id="user-menu">
          <button class="btn btn-small user-menu-toggle" id="user-menu-toggle">${esc(name)} ▾</button>
          <div class="user-menu-dropdown" id="user-menu-dropdown" hidden>
            <a href="#/settings">⚙️ Настройки</a>
            <button id="logout">Выйти</button>
          </div>
        </div>
      </div>
    </header>
    <div id="view" class="view"></div>
  `;

  const menu = root.querySelector<HTMLDivElement>('#user-menu')!;
  const dropdown = root.querySelector<HTMLDivElement>('#user-menu-dropdown')!;
  root.querySelector<HTMLButtonElement>('#user-menu-toggle')!.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.hidden = !dropdown.hidden;
  });
  document.addEventListener('click', (e) => {
    if (!dropdown.hidden && !menu.contains(e.target as Node)) dropdown.hidden = true;
  });
  dropdown.querySelector('a')!.addEventListener('click', () => {
    dropdown.hidden = true;
  });
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
      { pattern: /^#\/$/, render: renderDashboard },
      { pattern: /^#\/notebooks$/, render: renderNotebooks },
      { pattern: /^#\/notebooks\/([\w-]+)$/, render: renderNotebook },
      { pattern: /^#\/words\/([\w-]+)$/, render: renderWord },
      { pattern: /^#\/practice(?:\/(review|exercises))?$/, render: renderPractice },
      { pattern: /^#\/chat$/, render: renderChat },
      { pattern: /^#\/settings$/, render: renderSettings },
      { pattern: /^#\/search$/, render: renderSearch },
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
