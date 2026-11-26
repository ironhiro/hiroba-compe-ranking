// 대진표 컴포넌트: <bracket-view src="events/x/bracket.json"></bracket-view>
// 관리 페이지처럼 데이터를 직접 넘길 때는 element.data = bracketJson

import { deriveBracket } from '../core/bracket.js';
import { escapeHtml, formatDateTime, formatNumber, loadOptionalJson } from '../core/data.js';

const scoreText = (score) => (score === null || score === undefined || score === '' ? '' : formatNumber(score));

function renderSide(match, side) {
  const name = match.players[side];
  const classes = ['side'];
  if (!name) classes.push('tbd');
  if (match.result) classes.push(match.result.winner === side ? 'win' : 'lose');
  return `
      <div class="${classes.join(' ')}">
        <span class="who">${name ? escapeHtml(name) : '미정'}</span>
        <span class="pts">${match.result ? scoreText(match.result.scores?.[side]) : ''}</span>
      </div>`;
}

function renderMatch(match, label) {
  // 메모는 카드 안에 넣어야 카드 높이 중심과 연결선 위치가 맞는다.
  const note = match.result?.note ? `<p class="match-note">${escapeHtml(match.result.note)}</p>` : '';
  return `
    <div class="match${match.result ? ' done' : ''}">
      <div class="match-card">
        ${label ? `<span class="match-label">${escapeHtml(label)}</span>` : ''}
        ${renderSide(match, 0)}
        ${renderSide(match, 1)}
        ${note}
      </div>
    </div>`;
}

function renderRound(round, isLast) {
  // 두 매치씩 묶어야 다음 라운드로 이어지는 선을 그릴 수 있다.
  const groups = [];
  for (let i = 0; i < round.matches.length; i += 2) groups.push(round.matches.slice(i, i + 2));
  const body = isLast
    ? `<div class="pair final">${renderMatch(round.matches[0])}</div>`
    : groups.map((pair) => `<div class="pair">${pair.map((m) => renderMatch(m)).join('')}</div>`).join('');
  return `
  <section class="round${round.round === 0 ? ' first' : ''}">
    <h3>${escapeHtml(round.name)}</h3>
    <div class="round-body">${body}</div>
  </section>`;
}

function renderPodium({ champion, runnerUp, third }) {
  if (!champion && !runnerUp && third.length === 0) return '';
  const item = (label, cls, names) => (names.length
    ? `<div class="podium-item ${cls}"><span>${label}</span><strong>${names.map(escapeHtml).join(' · ')}</strong></div>`
    : '');
  return `
  <section class="podium">
    ${item('우승', 'gold', champion ? [champion] : [])}
    ${item('준우승', 'silver', runnerUp ? [runnerUp] : [])}
    ${item(third.length > 1 ? '공동 3위' : '3위', 'bronze', third)}
  </section>`;
}

export function renderBracket(rawBracket) {
  const derived = deriveBracket(rawBracket);
  const placed = derived.bracket.entrants.filter(Boolean).length;
  if (placed === 0) {
    return '<p class="empty">아직 대진이 발표되지 않았습니다.</p>';
  }
  const thirdPlace = derived.thirdPlace
    ? `<section class="third-place"><h3>3·4위전</h3>${renderMatch(derived.thirdPlace)}</section>`
    : '';
  const updated = derived.bracket.updatedAt ? `<p class="legend">마지막 반영 ${formatDateTime(derived.bracket.updatedAt)}</p>` : '';
  return `
  ${renderPodium(derived.podium)}
  ${updated}
  <div class="bracket-scroll">
    <div class="bracket">
      ${derived.rounds.map((round, i) => renderRound(round, i === derived.rounds.length - 1)).join('')}
    </div>
  </div>
  ${thirdPlace}`;
}

export class BracketView extends HTMLElement {
  #data = null;

  set data(value) {
    this.#data = value;
    this.render();
  }

  get data() {
    return this.#data;
  }

  async connectedCallback() {
    const src = this.getAttribute('src');
    if (!src || this.#data) {
      this.render();
      return;
    }
    this.innerHTML = '<p class="empty">불러오는 중…</p>';
    try {
      this.#data = await loadOptionalJson(src);
      this.render();
    } catch (error) {
      this.innerHTML = `<p class="empty">${escapeHtml(error?.message ?? error)}</p>`;
    }
  }

  render() {
    this.innerHTML = this.#data ? renderBracket(this.#data) : '<p class="empty">아직 대진이 발표되지 않았습니다.</p>';
  }
}

if (!customElements.get('bracket-view')) customElements.define('bracket-view', BracketView);
