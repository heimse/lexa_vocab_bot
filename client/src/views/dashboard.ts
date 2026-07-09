import { api } from '../api.js';
import { esc } from '../util.js';

interface DashboardData {
  totalWords: number;
  dueCount: number;
  newCount: number;
  streak: number;
  forecast: { date: string; count: number }[];
  statusCounts: Record<'NEW' | 'LEARNING' | 'REVIEW' | 'MASTERED', number>;
  recentNotebooks: { id: string; title: string; emoji: string | null; wordCount: number }[];
}

interface ActivityDay {
  date: string;
  reviews: number;
  totalWords: number;
}

const DAY_NAMES = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const MONTH_NAMES_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'май',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];

function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getDate()} ${MONTH_NAMES_SHORT[d.getMonth()]}`;
}

// Монотонная по светлоте одноцветная рампа на тёмной поверхности
function heatColor(reviews: number): string {
  if (reviews === 0) return '#1c2230';
  if (reviews <= 2) return '#2b3f74';
  if (reviews <= 5) return '#4568bd';
  return '#7aa2f7';
}

function renderHeatmap(days: ActivityDay[]): string {
  // Выравниваем начало по понедельнику, чтобы колонка = неделя
  const first = new Date(`${days[0]!.date}T00:00:00`);
  const padding = (first.getDay() + 6) % 7;
  const cells: (ActivityDay | null)[] = [...Array<null>(padding).fill(null), ...days];

  const weeks: string[] = [];
  for (let w = 0; w < cells.length; w += 7) {
    const column = cells
      .slice(w, w + 7)
      .map((day) =>
        day
          ? `<div class="heat-cell" style="background:${heatColor(day.reviews)}"
               title="${formatDay(day.date)}: ${day.reviews} повторений"></div>`
          : '<div class="heat-cell heat-empty"></div>',
      )
      .join('');
    weeks.push(`<div class="heat-week">${column}</div>`);
  }
  return `
    <div class="heatmap">${weeks.join('')}</div>
    <div class="heat-legend muted">
      меньше
      ${[0, 1, 3, 6].map((n) => `<span class="heat-cell" style="background:${heatColor(n)}"></span>`).join('')}
      больше
    </div>
  `;
}

function renderGrowth(days: ActivityDay[]): string {
  const width = 600;
  const height = 110;
  const pad = 4;
  const values = days.map((d) => d.totalWords);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);

  const points = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (width - pad * 2);
      const y = height - pad - ((v - min) / span) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return `
    <div class="growth">
      <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img"
        aria-label="Рост словаря: с ${min} до ${max} слов">
        <polyline points="${points}" fill="none" stroke="#7aa2f7" stroke-width="2"
          stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />
      </svg>
      <div class="growth-labels muted">
        <span>${formatDay(days[0]!.date)} · ${min}</span>
        <span>${formatDay(days[days.length - 1]!.date)} · <b>${max} слов</b></span>
      </div>
    </div>
  `;
}

function renderForecast(forecast: DashboardData['forecast']): string {
  const max = Math.max(...forecast.map((f) => f.count), 1);
  return `
    <div class="forecast">
      ${forecast
        .map((f, i) => {
          const date = new Date(`${f.date}T00:00:00`);
          const label = i === 0 ? 'сегодня' : DAY_NAMES[date.getDay()];
          const height = f.count === 0 ? 2 : Math.max(6, Math.round((f.count / max) * 56));
          return `
          <div class="forecast-day" title="${f.date}: ${f.count}">
            <span class="forecast-count">${f.count > 0 ? f.count : ''}</span>
            <div class="forecast-bar${i === 0 ? ' forecast-today' : ''}" style="height:${height}px"></div>
            <span class="forecast-label">${label}</span>
          </div>`;
        })
        .join('')}
    </div>
  `;
}

const STATUS_LABELS: [keyof DashboardData['statusCounts'], string][] = [
  ['NEW', 'Новые'],
  ['LEARNING', 'Изучаются'],
  ['REVIEW', 'Повторяются'],
  ['MASTERED', 'Выучены'],
];

export async function renderDashboard(container: HTMLElement): Promise<void> {
  const [data, activity] = await Promise.all([
    api<DashboardData>('/api/dashboard'),
    api<{ days: ActivityDay[] }>('/api/dashboard/activity'),
  ]);
  const toReview = data.dueCount + data.newCount;
  const hasActivity = activity.days.some((d) => d.reviews > 0 || d.totalWords > 0);

  container.innerHTML = `
    <section class="page">
      <div class="page-header">
        <h2>Dashboard</h2>
      </div>

      <div class="stat-row">
        <div class="stat-tile">
          <div class="stat-value">${data.totalWords}</div>
          <div class="stat-label">слов в словаре</div>
        </div>
        <div class="stat-tile stat-accent">
          <div class="stat-value">${toReview}</div>
          <div class="stat-label">к повторению сегодня</div>
        </div>
        <div class="stat-tile">
          <div class="stat-value">${data.newCount}</div>
          <div class="stat-label">новых слов</div>
        </div>
        <div class="stat-tile">
          <div class="stat-value">🔥 ${data.streak}</div>
          <div class="stat-label">${data.streak === 1 ? 'день' : data.streak >= 2 && data.streak <= 4 ? 'дня' : 'дней'} подряд</div>
        </div>
      </div>

      ${
        toReview > 0
          ? `<p><a class="btn btn-primary" href="#/review">▶ Начать повторение</a></p>`
          : `<p class="muted">🎉 На сегодня всё повторено.</p>`
      }

      <h3>Повторения на неделю</h3>
      ${renderForecast(data.forecast)}

      ${
        hasActivity
          ? `
      <h3>Активность за полгода</h3>
      ${renderHeatmap(activity.days)}

      <h3>Рост словаря</h3>
      ${renderGrowth(activity.days)}`
          : ''
      }

      <h3>Прогресс</h3>
      <div class="status-row">
        ${STATUS_LABELS.map(
          ([key, label]) => `
          <div class="status-item">
            <span class="status-count">${data.statusCounts[key]}</span>
            <span class="muted">${label}</span>
          </div>`,
        ).join('')}
      </div>

      <h3>Наборы <a class="muted all-link" href="#/notebooks">все →</a></h3>
      ${
        data.recentNotebooks.length === 0
          ? '<p class="muted">Наборов пока нет. <a href="#/notebooks">Создать первый</a></p>'
          : `<div class="cards">
              ${data.recentNotebooks
                .map(
                  (n) => `
                <a class="card card-link" href="#/notebooks/${n.id}">
                  <span class="card-emoji">${esc(n.emoji) || '📖'}</span>
                  <span class="card-title">${esc(n.title)}</span>
                  <span class="card-meta">${n.wordCount} слов</span>
                </a>`,
                )
                .join('')}
            </div>`
      }
    </section>
  `;
}
