// 예선 순위표 컴포넌트: <qualifier-board src="events/x/qualifier.json"></qualifier-board>
// 히로바 여러 방의 랭킹 스냅샷(확장이 게시)을 합쳐 순위를 매긴다.

import { escapeHtml, formatDateTime, formatNumber, formatScore, loadOptionalJson } from '../core/data.js';

const DAY_MS = 86_400_000;
const GAME_DAY_OFFSET_MS = 5 * 3_600_000; // 히로바의 하루는 05:00에 바뀐다
const DEFAULT_REFRESH = [10, 30];
const DEFAULT_RESERVES = 2; // 통과 인원 다음 순위를 예비 후보로 표시

const parseLocalDate = (isoDate) => {
  const [y, m, d] = (isoDate ?? '').split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};

const startOfGameDay = (ms) => {
  const date = new Date(ms - GAME_DAY_OFFSET_MS);
  date.setHours(0, 0, 0, 0);
  return date;
};

/** 시작일을 1일차로 하는 진행 일차. 시작 전이면 0 이하. */
export function seriesDay(config, at = Date.now()) {
  const start = parseLocalDate(config?.startDate);
  if (!start) return null;
  return Math.round((startOfGameDay(at) - start) / DAY_MS) + 1;
}

/** 마지막 날 점수가 반영되는 시각(종료 다음 날 갱신 시각). 이 이후 수집분부터 "확정". */
export function finalizeAt(config) {
  const start = parseLocalDate(config?.startDate);
  if (!start) return null;
  const [hour = DEFAULT_REFRESH[0], minute = DEFAULT_REFRESH[1]] = (config.refreshTime ?? '').split(':').map(Number);
  const date = new Date(start);
  date.setDate(date.getDate() + Number(config.days));
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

/**
 * 모든 방의 참가자를 합쳐 총점 순으로 순위를 매긴다.
 * - 같은 점수는 같은 순위(1,2,2,4…)
 * - 같은 사람이 여러 방에 있으면 높은 점수 하나만 쓴다
 * - 점수 미등록자는 순위 없이 따로 모은다
 */
export function buildStandings(snapshot, config, previousSnapshot = null) {
  const merged = new Map();
  const duplicates = [];
  for (const room of snapshot?.rooms ?? []) {
    for (const player of room.players ?? []) {
      const key = player.id ?? `${room.compeId}:${player.name}`;
      const entry = { ...player, key, roomNo: room.no };
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, entry);
        continue;
      }
      duplicates.push(`${player.name}: #${existing.roomNo}, #${room.no}`);
      if ((player.total ?? -1) > (existing.total ?? -1)) merged.set(key, entry);
    }
  }

  const all = [...merged.values()];
  const ranked = all.filter((p) => p.total !== null).sort((a, b) => b.total - a.total);
  const unranked = all.filter((p) => p.total === null).sort((a, b) => a.roomNo - b.roomNo || a.name.localeCompare(b.name));

  const previousRanks = previousSnapshot
    ? new Map(buildStandings(previousSnapshot, config).ranked.map((p) => [p.key, p.rank]))
    : null;
  const cutoff = Number(config.cutoff);
  const reserves = Number(config.reserves ?? DEFAULT_RESERVES);
  const cutoffScore = ranked[cutoff - 1]?.total ?? null;
  const finalTime = finalizeAt(config);
  const finalized = Boolean(snapshot?.collectedAt && finalTime && snapshot.collectedAt >= finalTime);

  let lastScore = null;
  let lastRank = 0;
  ranked.forEach((player, index) => {
    player.rank = player.total === lastScore ? lastRank : index + 1;
    lastScore = player.total;
    lastRank = player.rank;
    const before = previousRanks?.get(player.key);
    player.change = before ? before - player.rank : null;
    player.isNew = Boolean(previousRanks) && !before;
    player.qualified = player.rank <= cutoff;
    player.reserve = !player.qualified && player.rank <= cutoff + reserves;
    player.gap = !player.qualified && cutoffScore !== null ? cutoffScore - player.total : null;
  });
  // 동점 때문에 같은 순위가 여러 명이어도 구분선은 그룹의 마지막 행에만 긋는다.
  ranked.forEach((player, index) => {
    const next = ranked[index + 1];
    player.lastQualified = player.qualified && !next?.qualified;
    player.lastReserve = player.reserve && !next?.reserve;
  });

  return { ranked, unranked, duplicates, finalized, cutoff, reserves };
}

// ---------- 렌더링 ----------


function statusBadge(player, standings) {
  if (player.qualified) {
    return standings.finalized
      ? '<span class="badge final">예선 확정</span>'
      : '<span class="badge likely">예선 유력</span>';
  }
  const gap = player.gap !== null ? `<small>컷까지 ${formatNumber(player.gap)}점</small>` : '';
  if (player.reserve) {
    return `<span class="badge reserve">${standings.finalized ? '예비 확정' : '후보'}</span>${gap}`;
  }
  return `<span class="badge out">${standings.finalized ? '탈락' : '권외'}</span>${gap}`;
}

function changeMark(player) {
  if (player.isNew) return '<span class="chg new">NEW</span>';
  if (!player.change) return '<span class="chg same">-</span>';
  return player.change > 0
    ? `<span class="chg up">▲${player.change}</span>`
    : `<span class="chg down">▼${-player.change}</span>`;
}

const renderSongs = (player) => (player.songs ?? [])
  .map((song) => `<li><span class="song-name">${escapeHtml(song.name)}</span><b>${formatScore(song.score)}</b></li>`)
  .join('') || '<li>곡 정보 없음</li>';

function renderRankedRow(player, standings) {
  const classes = [
    'row',
    player.qualified ? 'in' : '',
    player.reserve ? 'reserve' : '',
    player.lastQualified ? 'cutline' : '',
    player.lastReserve ? 'reserveline' : '',
  ].filter(Boolean).join(' ');
  return `
  <details class="${classes}">
    <summary>
      <span class="rank">${player.rank}</span>
      ${changeMark(player)}
      <span class="name">${escapeHtml(player.name)}</span>
      <span class="room">#${escapeHtml(player.roomNo)}</span>
      <span class="total">${formatScore(player.total)}</span>
      <span class="status">${statusBadge(player, standings)}</span>
    </summary>
    <ul class="songs">${renderSongs(player)}</ul>
  </details>`;
}

const renderUnrankedRow = (player) => `
  <li><span class="name">${escapeHtml(player.name)}</span><span class="room">#${escapeHtml(player.roomNo)}</span></li>`;

const HIROBA_COMPE_URL = 'https://donderhiroba.jp/compe_detail.php?compeid=';

/** "15人（現在8人）" → 현재 인원이 정원 이상이면 true. 형식이 다르면 false. */
export function isRoomFull(members) {
  const match = String(members ?? '').match(/(\d+)\s*人\s*[（(]\s*現在\s*(\d+)\s*人/);
  return match ? Number(match[2]) >= Number(match[1]) : false;
}

function renderRoom(room) {
  const label = `<b>#${escapeHtml(room.no)}</b> ${escapeHtml(room.host)}`;
  const link = /^\d+$/.test(String(room.compeId ?? ''))
    ? `<a href="${HIROBA_COMPE_URL}${room.compeId}" target="_blank" rel="noopener">${label}</a>`
    : label;
  const full = isRoomFull(room.members) ? ' <span class="full">만석입니다</span>' : '';
  return `
    <li>${link} · ${escapeHtml(room.members)}${full}</li>`;
}

/** 순위표 본문 HTML */
export function renderBoard(data) {
  const { config, snapshots } = data ?? {};
  const [snapshot, previousSnapshot = null] = Array.isArray(snapshots) ? snapshots : [];
  if (!config || !snapshot) {
    return '<p class="empty">아직 집계된 데이터가 없습니다.</p>';
  }

  const standings = buildStandings(snapshot, config, previousSnapshot);
  const day = seriesDay(config, snapshot.collectedAt);
  let dayText = '-';
  if (standings.finalized) dayText = `${config.days}일 종료 · 최종`;
  else if (day !== null && day < 1) dayText = '시작 전';
  else if (day !== null) dayText = `${Math.min(day, Number(config.days))} / ${config.days}일차`;

  const rooms = snapshot.rooms.map(renderRoom).join('');
  const notes = [
    ...(snapshot.errors ?? []),
    ...standings.duplicates.map((d) => `중복 참가(높은 점수만 집계): ${d}`),
  ].map((n) => `<li>${escapeHtml(n)}</li>`).join('');

  const rankedRows = standings.ranked.map((p) => renderRankedRow(p, standings)).join('');
  const unranked = standings.unranked.length ? `
  <section class="unranked">
    <h2>순위 미정 <small>${standings.unranked.length}명</small></h2>
    <ul>${standings.unranked.map(renderUnrankedRow).join('')}</ul>
  </section>` : '';

  return `
  <section class="summary">
    <div><span class="label">진행</span><strong>${escapeHtml(dayText)}</strong></div>
    <div><span class="label">순위 집계</span><strong>${standings.ranked.length}명</strong></div>
    <div><span class="label">순위 미정</span><strong>${standings.unranked.length}명</strong></div>
    <div><span class="label">데이터 갱신일자</span><strong>${formatDateTime(snapshot.collectedAt)}</strong></div>
  </section>
  <p class="legend">상위 <b>${standings.cutoff}위</b>는 본선 진출 ${standings.finalized ? '확정' : '유력'}${standings.reserves > 0 ? `, <b>${standings.cutoff + 1}${standings.reserves > 1 ? `~${standings.cutoff + standings.reserves}` : ''}위</b>는 예비후보입니다. 예비후보는 대회 진행사항에 따라 대체될 수 있습니다.` : '입니다.'}</p>
  <div class="board">
    <div class="head"><span>순위</span><span>변동</span><span>플레이어</span><span>방</span><span>총점</span><span>상태</span></div>
    ${rankedRows || '<p class="empty">아직 점수를 등록한 참가자가 없습니다.</p>'}
  </div>
  ${unranked}
  <details class="rooms"><summary>방 목록 (${snapshot.rooms.length}) <small>왼쪽의 유저를 클릭하면 대회 정보를 확인할 수 있습니다</small></summary><ul>${rooms}</ul></details>
  ${notes ? `<details class="notes"><summary>참고 (${standings.duplicates.length + (snapshot.errors?.length ?? 0)})</summary><ul>${notes}</ul></details>` : ''}`;
}

export class QualifierBoard extends HTMLElement {
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
      this.dispatchEvent(new CustomEvent('loaded', { detail: this.#data, bubbles: true }));
    } catch (error) {
      this.innerHTML = `<p class="empty">${escapeHtml(error?.message ?? error)}</p>`;
    }
  }

  render() {
    this.innerHTML = renderBoard(this.#data);
  }
}

if (!customElements.get('qualifier-board')) customElements.define('qualifier-board', QualifierBoard);
