// 히로바 HTML 파싱과 qualifier.json 가공. 네트워크를 쓰지 않는 순수 함수만 둔다.
// 파싱 규칙은 확장(HirobaCompeScheduler/lib/series-task.js)과 같게 유지한다.
import { createHash } from 'node:crypto';
import { DOMParser } from 'linkedom';

const COMPE_ID_RE = /compeid=(\d+)/;
const TAIKO_NO_RE = /taiko_no=(\d+)/;
const SCORE_RE = /([\d,]+)\s*点/;
const RANK_RE = /(\d+)\s*位/;
const AS_OF_RE = /(\d+)月(\d+)日/;
const TEXT_NODE = 3;
const ID_HASH_LENGTH = 16;
const PUBLISHED_SNAPSHOTS = 2; // 최신 + 전날 (순위 변동 표시용) — 확장과 같음
const GAME_DAY_OFFSET_MS = 5 * 3_600_000; // 히로바의 하루는 05:00에 바뀐다

export const parseHtml = (html) => new DOMParser().parseFromString(html, 'text/html');

const squash = (text) => (text ?? '').replace(/\s+/g, ' ').trim();
const normalize = (text) => squash(text).normalize('NFKC');
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const textNodes = (el) => [...(el?.childNodes ?? [])]
  .filter((node) => node.nodeType === TEXT_NODE)
  .map((node) => squash(node.textContent))
  .filter(Boolean);
const toScore = (text) => {
  const match = (text ?? '').match(SCORE_RE);
  return match ? Number(match[1].replace(/,/g, '')) : null;
};

/** "<이름> #N" 형식이면 N을, 아니면 null을 돌려주는 함수 */
export function roomMatcher(seriesName) {
  const base = normalize(seriesName);
  // 예: "붕오떡컵 - #3", "붕오떡컵-#3", "붕오떡컵 #3"
  const roomRe = new RegExp(`^${escapeRe(base)}\\s*[-‐－ー~〜]?\\s*#\\s*(\\d+)$`);
  return (name) => normalize(name).match(roomRe)?.[1] ?? null;
}

/** compe_list.php 한 페이지 → { items: [{id, name}], hasNext } */
export function parseCompeList(doc, page) {
  const items = [...doc.querySelectorAll('li.festival')].map((item) => ({
    id: (item.querySelector('a[href*="compeid"]')?.getAttribute('href') ?? '').match(COMPE_ID_RE)?.[1] ?? null,
    name: squash(item.querySelector('.CompeStatus li')?.textContent).replace(/^大会名\s*[：:]\s*/, ''),
  }));
  const hasNext = [...doc.querySelectorAll('a[href*="compe_list.php"]')]
    .some((link) => (link.getAttribute('href') ?? '').includes(`page=${page + 1}`));
  return { items, hasNext };
}

/** compe_detail.php → { 大会名, 主催, 人数 } */
export function parseCompeDetail(doc) {
  return Object.fromEntries([...doc.querySelectorAll('li, p, div')]
    .map((el) => squash(el.textContent).match(/^(大会名|主催|人数)\s*[：:]\s*(.+)$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value]));
}

/** compe_ranking.php → { asOf, players } (players에는 아직 taikoNo가 들어 있다) */
export function parseCompeRanking(doc) {
  const asOf = squash(doc.querySelector('.now')?.textContent).match(AS_OF_RE);
  const players = [...doc.querySelectorAll('.festivalRankThumbList')].map((row) => {
    const info = row.querySelector('.player-info');
    const [playerName = '?', scoreText = ''] = textNodes(info?.querySelector('div'));
    const taikoNo = (info?.querySelector('img')?.getAttribute('onclick') ?? '').match(TAIKO_NO_RE)?.[1] ?? null;
    const songs = [...row.querySelectorAll('.block > div')].map((block) => {
      const [songName, songScore] = [...block.querySelectorAll('p')].map((p) => squash(p.textContent));
      return { name: songName ?? '', score: toScore(songScore) };
    });
    return {
      taikoNo,
      name: playerName,
      total: toScore(scoreText),
      roomRank: Number(squash(row.querySelector('.compeRankingText')?.textContent).match(RANK_RE)?.[1]) || null,
      songs,
    };
  });
  return { asOf: asOf ? `${asOf[1]}/${asOf[2]}` : null, players };
}

/** 태고 번호는 공개하지 않고 salt를 붙인 해시만 쓴다. 확장과 같은 salt여야 ID가 이어진다. */
export function anonymizeId(taikoNo, salt) {
  if (!taikoNo) return null;
  return createHash('sha256').update(`${salt}:${taikoNo}`).digest('hex').slice(0, ID_HASH_LENGTH);
}

export function toSnapshot(collected, salt) {
  return {
    collectedAt: collected.collectedAt,
    rooms: collected.rooms.map((room) => ({
      compeId: room.compeId,
      no: room.no,
      name: room.name,
      host: room.host,
      members: room.members,
      asOf: room.asOf,
      players: room.players.map(({ taikoNo, ...player }) => ({ id: anonymizeId(taikoNo, salt), ...player })),
    })),
    errors: collected.errors ?? [],
  };
}

// 아래 날짜 계산은 TZ=Asia/Seoul 에서 실행된다고 가정한다(워크플로에서 지정).

/** 05:00 기준 게임 일자 (YYYY-MM-DD) */
export function gameDayKey(ms) {
  const date = new Date(ms - GAME_DAY_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 마지막 날 점수가 반영되는 시각(종료 다음 날 갱신 시각) */
export function finalizeAt(config) {
  const [y, m, d] = (config.startDate ?? '').split('-').map(Number);
  if (!y || !m || !d) return null;
  const [hour, minute] = (config.refreshTime ?? '10:30').split(':').map(Number);
  return new Date(y, m - 1, d + Number(config.days), hour, minute).getTime();
}

/** 같은 게임 일자의 스냅샷은 덮어쓰고, 최신순으로 limit개만 남긴다. */
export function mergeSnapshot(snapshots, snapshot, limit) {
  const day = gameDayKey(snapshot.collectedAt);
  const rest = (snapshots ?? []).filter((s) => gameDayKey(s.collectedAt) !== day);
  return [snapshot, ...rest].sort((a, b) => b.collectedAt - a.collectedAt).slice(0, limit);
}

/** 순위 수집: 새 게임 일자 스냅샷을 만든다(같은 일자면 덮어씀). */
export function applyRanking(data, collected, salt) {
  const snapshot = { ...toSnapshot(collected, salt), membersAt: collected.collectedAt };
  const players = snapshot.rooms.reduce((sum, room) => sum + room.players.length, 0);
  return {
    next: { ...data, updatedAt: Date.now(), snapshots: mergeSnapshot(data.snapshots, snapshot, PUBLISHED_SNAPSHOTS) },
    changed: true,
    line: `방 ${snapshot.rooms.length}개 · 참가자 ${players}명`,
    errors: snapshot.errors,
  };
}

/**
 * 인원 갱신: 최신 스냅샷의 방 주최·인원만 바꾸고, 새로 생긴 방은 참가자 없이 추가한다.
 * 점수와 collectedAt은 건드리지 않는다(전날 대비 순위 변동이 유지되도록).
 */
export function applyMembers(data, collected) {
  const [latest, ...rest] = data.snapshots;
  const fresh = new Map(collected.rooms.map((room) => [String(room.compeId), room]));
  const diffs = [];
  const rooms = latest.rooms.map((room) => {
    const now = fresh.get(String(room.compeId));
    fresh.delete(String(room.compeId));
    if (!now || (now.members === room.members && now.host === room.host)) return room;
    diffs.push(`#${room.no} ${room.members} → ${now.members}`);
    return { ...room, host: now.host, members: now.members };
  });
  for (const room of fresh.values()) {
    diffs.push(`#${room.no} 새 방 (${room.members})`);
    rooms.push({ ...room, asOf: null, players: [] });
  }
  rooms.sort((a, b) => a.no - b.no);

  if (diffs.length === 0) return { next: data, changed: false, line: '인원 변동 없음', errors: [] };
  return {
    next: { ...data, updatedAt: Date.now(), snapshots: [{ ...latest, rooms, membersAt: collected.collectedAt }, ...rest] },
    changed: true,
    line: `인원 변동 ${diffs.length}건 (${diffs.join(', ')})`,
    errors: collected.errors,
  };
}
