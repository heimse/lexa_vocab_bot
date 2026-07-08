export interface Route {
  pattern: RegExp;
  render: (container: HTMLElement, params: string[]) => void | Promise<void>;
}

let routes: Route[] = [];
let container: HTMLElement | null = null;

export function initRouter(viewContainer: HTMLElement, appRoutes: Route[]): void {
  container = viewContainer;
  routes = appRoutes;
  window.addEventListener('hashchange', () => void renderCurrent());
  void renderCurrent();
}

export async function renderCurrent(): Promise<void> {
  if (!container) return;
  const hash = location.hash || '#/';
  for (const route of routes) {
    const match = hash.match(route.pattern);
    if (match) {
      container.innerHTML = `<p class="muted loading">Загрузка…</p>`;
      try {
        await route.render(container, match.slice(1));
      } catch (err) {
        console.error(err);
        container.innerHTML = `
          <p class="error">Что-то пошло не так. Попробуйте обновить страницу.</p>
          <p><a href="#/">На главную</a></p>`;
      }
      return;
    }
  }
  container.innerHTML = `<p>Страница не найдена. <a href="#/">На главную</a></p>`;
}
