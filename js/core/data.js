// 공용 유틸: 데이터 경로, JSON 로딩, 포맷터

import { applyFont, applyTheme } from './theme.js';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const NUMBER_FORMAT = new Intl.NumberFormat('ko-KR');

export const EVENTS_INDEX = 'events/index.json';
export const DEFAULT_LOGO = 'assets/logo.svg';

/** URL의 ?e= 값(대회 id). 경로 조작을 막기 위해 형식을 검사한다. */
export function currentEventId() {
  const id = new URLSearchParams(location.search).get('e') ?? '';
  return SLUG_RE.test(id) ? id : null;
}

export const eventPath = (eventId, file) => `events/${eventId}/${file}`;

export async function loadJson(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}을(를) 불러오지 못했습니다 (HTTP ${res.status})`);
  return res.json();
}

/** 없는 파일은 null (아직 데이터가 없는 단계) */
export async function loadOptionalJson(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path}을(를) 불러오지 못했습니다 (HTTP ${res.status})`);
  return res.json();
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

export const formatNumber = (n) => NUMBER_FORMAT.format(n);
export const formatScore = (score) => (score === null || score === undefined || score === '' ? '미등록' : `${formatNumber(score)}점`);
export const formatDateTime = (ms) => new Date(ms).toLocaleString('ko-KR', {
  month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit',
});

/** 대회 테마(색)와 헤더(로고·제목·부제)를 적용한다. */
export function applyEventHeader(event, { title, subtitle, logo }) {
  applyTheme(event?.theme);
  applyFont(event?.font);
  if (event?.name) {
    title.textContent = event.name;
    document.title = event.name;
  }
  if (subtitle && event?.description) subtitle.textContent = event.description;
  if (logo) {
    logo.src = event?.logo ?? 'assets/logo.png';
    logo.addEventListener('error', () => { logo.src = DEFAULT_LOGO; }, { once: true });
  }
}
