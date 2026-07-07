const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <main class="landing">
    <h1>LEXA</h1>
    <p>Не просто словарь. Личная память для иностранных слов.</p>
    <p class="api-status">API: <span id="api-status">проверка…</span></p>
  </main>
`;

const statusEl = document.querySelector<HTMLSpanElement>('#api-status')!;

fetch('/api/health')
  .then((res) => res.json())
  .then((data: { status: string }) => {
    statusEl.textContent = data.status === 'ok' ? 'работает ✅' : 'ошибка';
  })
  .catch(() => {
    statusEl.textContent = 'недоступен ❌';
  });
