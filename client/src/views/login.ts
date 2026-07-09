import { api, type AuthConfig } from '../api.js';

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, unknown>) => void;
  }
}

export async function renderLogin(root: HTMLElement, onLogin: () => Promise<void>): Promise<void> {
  const config = await api<AuthConfig>('/api/auth/config');

  root.innerHTML = `
    <main class="landing">
      <h1>LEXA</h1>
      <p>Не просто словарь. Личная память для иностранных слов.</p>
      <div class="login-actions" id="login-actions"></div>
    </main>
  `;
  const actions = root.querySelector<HTMLDivElement>('#login-actions')!;

  if (config.botUsername) {
    window.onTelegramAuth = async (user) => {
      try {
        await api('/api/auth/telegram', { method: 'POST', body: JSON.stringify(user) });
        await onLogin();
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

  // Вход через бота — работает и без привязанного домена (прод на голом IP)
  if (config.botUsername) {
    const botButton = document.createElement('button');
    botButton.className = 'btn btn-primary';
    botButton.textContent = '🤖 Войти через Telegram-бота';
    const hint = document.createElement('p');
    hint.className = 'muted';
    botButton.addEventListener('click', async () => {
      const { nonce, url } = await api<{ nonce: string; url: string }>(
        '/api/auth/bot-login/start',
        {
          method: 'POST',
        },
      );
      window.open(url, '_blank');
      hint.textContent = 'Откройте бота и нажмите «Start» — вход подтвердится сам…';

      const deadline = Date.now() + 5 * 60 * 1000;
      const poll = async (): Promise<void> => {
        if (Date.now() > deadline) {
          hint.textContent = 'Время вышло — попробуйте ещё раз.';
          return;
        }
        const result = await api<{ ok: boolean }>('/api/auth/bot-login/poll', {
          method: 'POST',
          body: JSON.stringify({ nonce }),
        });
        if (result.ok) {
          await onLogin();
        } else {
          setTimeout(() => void poll(), 2000);
        }
      };
      void poll();
    });
    actions.appendChild(botButton);
    actions.appendChild(hint);
  }

  if (config.devMode) {
    const devButton = document.createElement('button');
    devButton.className = 'btn';
    devButton.textContent = 'Dev-вход (без Telegram)';
    devButton.addEventListener('click', async () => {
      await api('/api/auth/dev', { method: 'POST' });
      await onLogin();
    });
    actions.appendChild(devButton);
  }
}
