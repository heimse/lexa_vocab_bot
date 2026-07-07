import { api, ApiError, type AuthConfig, type CurrentUser } from './api.js';

const app = document.querySelector<HTMLDivElement>('#app')!;

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

async function renderLogin(): Promise<void> {
  const config = await api<AuthConfig>('/api/auth/config');

  app.innerHTML = `
    <main class="landing">
      <h1>LEXA</h1>
      <p>Не просто словарь. Личная память для иностранных слов.</p>
      <div class="login-actions" id="login-actions"></div>
    </main>
  `;
  const actions = document.querySelector<HTMLDivElement>('#login-actions')!;

  if (config.botUsername) {
    window.onTelegramAuth = async (user) => {
      try {
        await api('/api/auth/telegram', { method: 'POST', body: JSON.stringify(user) });
        await start();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Ошибка входа');
      }
    };
    const script = document.createElement('script');
    script.src = 'https://telegram.org/widgets/login.js';
    script.async = true;
    script.dataset.telegramLogin = config.botUsername;
    script.dataset.size = 'large';
    script.dataset.onauth = 'onTelegramAuth(user)';
    script.dataset.requestAccess = 'write';
    actions.appendChild(script);
  }

  if (config.devMode) {
    const devButton = document.createElement('button');
    devButton.className = 'btn';
    devButton.textContent = 'Dev-вход (без Telegram)';
    devButton.addEventListener('click', async () => {
      await api('/api/auth/dev', { method: 'POST' });
      await start();
    });
    actions.appendChild(devButton);
  }
}

function renderHome(user: CurrentUser): void {
  const name = user.firstName ?? user.username ?? 'пользователь';
  app.innerHTML = `
    <main class="landing">
      <h1>LEXA</h1>
      <p>Привет, ${name}! Вы вошли через Telegram.</p>
      <p class="muted">Dashboard появится на следующих этапах.</p>
      <button class="btn" id="logout">Выйти</button>
    </main>
  `;
  document.querySelector<HTMLButtonElement>('#logout')!.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    await start();
  });
}

async function start(): Promise<void> {
  try {
    const user = await api<CurrentUser>('/api/auth/me');
    renderHome(user);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      await renderLogin();
    } else {
      app.innerHTML = `<main class="landing"><h1>LEXA</h1><p>Сервер недоступен</p></main>`;
    }
  }
}

void start();
