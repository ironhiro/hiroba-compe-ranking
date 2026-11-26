import { EVENTS_INDEX, escapeHtml, loadJson } from '../core/data.js';
import { applyTheme } from '../core/theme.js';

const STATUS_LABELS = Object.freeze({
  upcoming: '예정',
  qualifier: '예선 진행 중',
  main: '본선',
  finished: '종료',
});

const list = document.getElementById('events');

async function main() {
  try {
    const { events = [], theme } = await loadJson(EVENTS_INDEX);
    applyTheme(theme);
    const visible = events.filter((event) => !event.hidden);
    if (visible.length === 0) {
      list.innerHTML = '<li class="empty">공개된 대회가 없습니다.</li>';
      return;
    }
    list.innerHTML = visible.map((event) => `
      <li>
        <a href="${encodeURIComponent(event.id)}/">
          <strong>${escapeHtml(event.name)}</strong>
          ${event.period ? `<span>${escapeHtml(event.period)}</span>` : ''}
          ${event.status ? `<em class="badge ${escapeHtml(event.status)}">${escapeHtml(STATUS_LABELS[event.status] ?? event.status)}</em>` : ''}
        </a>
      </li>`).join('');
  } catch (error) {
    list.innerHTML = `<li class="empty">${escapeHtml(error?.message ?? error)}</li>`;
  }
}

main();
