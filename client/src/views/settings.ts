import { api } from '../api.js';
import { esc } from '../util.js';

interface Settings {
  username: string | null;
  firstName: string | null;
  nativeLanguage: string;
  targetLanguage: string;
  dailyDueLimit: number;
  dailyNewLimit: number;
  notifyEnabled: boolean;
  notifyHour: number;
}

const LANGUAGES: [string, string][] = [
  ['ru', 'Русский'],
  ['en', 'English'],
  ['uk', 'Українська'],
  ['pl', 'Polski'],
  ['de', 'Deutsch'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['it', 'Italiano'],
  ['pt', 'Português'],
];

function languageOptions(selected: string): string {
  return LANGUAGES.map(
    ([code, name]) =>
      `<option value="${code}" ${selected === code ? 'selected' : ''}>${name}</option>`,
  ).join('');
}

export async function renderSettings(container: HTMLElement): Promise<void> {
  const settings = await api<Settings>('/api/settings');

  container.innerHTML = `
    <section class="page">
      <div class="page-header"><h2>Настройки</h2></div>
      <p class="muted">Аккаунт: ${esc(settings.firstName)}${
        settings.username ? ` (@${esc(settings.username)})` : ''
      } · вход через Telegram</p>
      <form class="word-form" id="settings-form">
        <label>Изучаемый язык
          <select name="targetLanguage">${languageOptions(settings.targetLanguage)}</select>
        </label>
        <label>Родной язык (язык переводов)
          <select name="nativeLanguage">${languageOptions(settings.nativeLanguage)}</select>
        </label>
        <label>Повторений в день (макс.)
          <input name="dailyDueLimit" type="number" min="1" max="200" value="${settings.dailyDueLimit}" />
        </label>
        <label>Новых слов в день (макс.)
          <input name="dailyNewLimit" type="number" min="0" max="100" value="${settings.dailyNewLimit}" />
        </label>
        <label class="checkbox-label">
          <input name="notifyEnabled" type="checkbox" ${settings.notifyEnabled ? 'checked' : ''} />
          Ежедневное напоминание в Telegram
        </label>
        <label>Время напоминания
          <select name="notifyHour">
            ${Array.from({ length: 24 }, (_, h) => {
              const label = `${String(h).padStart(2, '0')}:00`;
              return `<option value="${h}" ${settings.notifyHour === h ? 'selected' : ''}>${label}</option>`;
            }).join('')}
          </select>
        </label>
        <div class="word-actions">
          <button type="submit" class="btn btn-primary">Сохранить</button>
          <span class="muted" id="settings-status"></span>
        </div>
      </form>
      <p class="muted">Изучаемый и родной языки влияют на заполнение новых карточек и AI-тьютора.</p>
    </section>
  `;

  const form = container.querySelector<HTMLFormElement>('#settings-form')!;
  const status = container.querySelector<HTMLSpanElement>('#settings-status')!;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(form);
    try {
      await api('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          targetLanguage: String(data.get('targetLanguage')),
          nativeLanguage: String(data.get('nativeLanguage')),
          dailyDueLimit: Number(data.get('dailyDueLimit')),
          dailyNewLimit: Number(data.get('dailyNewLimit')),
          notifyEnabled: data.get('notifyEnabled') === 'on',
          notifyHour: Number(data.get('notifyHour')),
        }),
      });
      status.textContent = 'Сохранено ✓';
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : 'Ошибка сохранения';
    }
  });
}
