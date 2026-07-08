import { api } from '../api.js';
import { esc } from '../util.js';

interface DashboardData {
  totalWords: number;
  dueCount: number;
  newCount: number;
  statusCounts: Record<'NEW' | 'LEARNING' | 'REVIEW' | 'MASTERED', number>;
  recentNotebooks: { id: string; title: string; emoji: string | null; wordCount: number }[];
}

const STATUS_LABELS: [keyof DashboardData['statusCounts'], string][] = [
  ['NEW', 'Новые'],
  ['LEARNING', 'Изучаются'],
  ['REVIEW', 'Повторяются'],
  ['MASTERED', 'Выучены'],
];

export async function renderDashboard(container: HTMLElement): Promise<void> {
  const data = await api<DashboardData>('/api/dashboard');
  const toReview = data.dueCount + data.newCount;

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
      </div>

      ${
        toReview > 0
          ? `<p><a class="btn btn-primary" href="#/review">▶ Начать повторение</a></p>`
          : `<p class="muted">🎉 На сегодня всё повторено.</p>`
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
