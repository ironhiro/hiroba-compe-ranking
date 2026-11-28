// GitHub Actions에서 실행: 히로바에 로그인 → 진행 중인 예선의 방 순위·인원 수집 → events/<id>/qualifier.json 갱신.
// 커밋·푸시는 워크플로가 한다. 이 스크립트는 파일만 쓴다.
//
// 환경 변수
//   HIROBA_EMAIL, HIROBA_PASSWORD  반다이남코 ID (필수)
//   HIROBA_ID_SALT                 플레이어 ID 해시용 salt. 확장과 같은 값이어야 전날 순위 비교가 이어진다 (필수)
//   HIROBA_TAIKO_NO                로그인할 카드의 태고 번호 (선택, 없으면 첫 카드)
//   EVENT                          특정 대회 id만 수집 (선택, 없으면 status가 qualifier인 대회 전부)
//   MODE=ranking | members         ranking: 순위 수집(하루 1번, 새 스냅샷) / members: 방 인원만 갱신(매시간)
//   FORCE=1                       기간·최종 집계 여부와 상관없이 수집
//   DRY_RUN=1                      파일을 쓰지 않고 결과만 출력
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyMembers, applyRanking, finalizeAt, parseCompeDetail, parseCompeList, parseCompeRanking, parseHtml, roomMatcher,
} from './parse.mjs';

// hiroba-js의 ESM 빌드는 확장자 없는 import라 Node에서 못 불러온다 → CJS 빌드 사용
const { Func, util } = createRequire(import.meta.url)('hiroba-js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://donderhiroba.jp';
const MAX_SEARCH_PAGES = 20;
const REQUEST_GAP_MS = 400;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 60_000;

const env = process.env;
const MODE = env.MODE?.trim() || 'ranking';
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const log = (...args) => console.log(...args);
const summary = [];
let loginHadNoCard = false;

class CollectError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * hiroba-js는 실패 시 Response 객체를 console.log로 찍는다.
 * Public 레포의 Actions 로그는 누구나 볼 수 있으므로, 로그인 중에는 콘솔 출력을 막는다.
 */
async function quietly(fn) {
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, original);
  }
}

async function login() {
  const email = env.HIROBA_EMAIL?.trim();
  const password = env.HIROBA_PASSWORD;
  if (!email || !password) throw new CollectError('CONFIG', 'HIROBA_EMAIL / HIROBA_PASSWORD 시크릿이 없습니다.');

  let noCard = false;
  const token = await quietly(async () => {
    const sessionToken = await Func.getSessionToken({ email, password });
    const cardList = await Func.getCardList({ token: sessionToken }).catch(() => []);
    // 카드가 없는 계정은 카드 선택 없이 진행한다(대회 페이지가 열리는지는 compe_top 확인에서 판정).
    if (!cardList?.length) {
      noCard = true;
      return sessionToken;
    }
    const wanted = env.HIROBA_TAIKO_NO?.trim();
    const card = wanted ? cardList.find((c) => String(c.taikoNumber) === wanted) : cardList[0];
    if (!card) throw new CollectError('NO_CARD', 'HIROBA_TAIKO_NO와 일치하는 카드가 없습니다.');
    await Func.cardLogin({ token: sessionToken, taikoNumber: card.taikoNumber, cardList });
    return sessionToken;
  }).catch((error) => {
    if (error instanceof CollectError) throw error;
    // HirobaError의 code만 남기고 응답 내용은 버린다.
    // 비밀번호가 틀렸을 때 재시도하면 계정이 잠길 수 있으므로 바로 멈춘다.
    const reason = error?.code ?? error?.message ?? 'unknown';
    throw new CollectError('LOGIN', `히로바 로그인 실패 (${reason})`, { retryable: reason !== 'INVALID_ID_PASSWORD' });
  });

  if (env.GITHUB_ACTIONS) log(`::add-mask::${token}`);
  loginHadNoCard = noCard;
  log(noCard ? '로그인 성공 (등록된 카드 없음, 카드 선택 없이 진행)' : '로그인 성공');
  return token;
}

function makeClient(token) {
  let last = 0;
  return async function getDoc(pathname) {
    const wait = last + REQUEST_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(new URL(pathname, ORIGIN), { headers: util.createHeader(`_token_v2=${token}`) })
      .catch((error) => { throw new CollectError('NETWORK', `${error?.cause?.code ?? error.message}: ${pathname}`, { retryable: true }); });
    if (!res.ok) throw new CollectError('HTTP', `HTTP ${res.status}: ${pathname}`, { retryable: true });
    return { doc: parseHtml(await res.text()), path: new URL(res.url).pathname };
  };
}

/** 로그인 확인 + "<이름> #N" 방 검색. 검색은 진행 중인 대회만 나오므로 이전에 찾은 방(knownIds)도 합친다. */
async function searchRooms(getDoc, seriesName, knownIds) {
  const roomNo = roomMatcher(seriesName);
  const base = seriesName.normalize('NFKC').replace(/\s+/g, ' ').trim();

  const top = await getDoc('/compe_top.php');
  if (top.path !== '/compe_top.php') {
    if (loginHadNoCard) {
      // 카드 없는 계정은 다시 로그인해도 같으므로 재시도하지 않는다.
      throw new CollectError('NO_CARD', `카드가 등록되지 않은 계정이라 히로바 대회 페이지를 열 수 없습니다 (${top.path}로 이동). 계정에 카드를 등록하고 한 번 플레이해야 합니다.`);
    }
    throw new CollectError('NOT_LOGGED_IN', '히로바 세션이 유효하지 않습니다.', { retryable: true });
  }

  const found = new Map();
  const unmatched = new Set();
  for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
    const query = new URLSearchParams({
      is_bng_compe: '0', is_past: '0', mode: '1', name: base, master: '',
      compe_days: '0', friend_range: '0', page: String(page),
    });
    const { doc } = await getDoc(`/compe_list.php?${query}`);
    const { items, hasNext } = parseCompeList(doc, page);
    for (const { id, name } of items) {
      if (id && roomNo(name)) found.set(id, name);
      else if (name) unmatched.add(name);
    }
    if (items.length === 0 || !hasNext) break;
  }
  return { roomNo, found, unmatched, ids: [...new Set([...found.keys(), ...knownIds])] };
}

/**
 * 확장의 pageCollectSeries와 같은 흐름: 검색 → 상세(주최·인원) → (withRanking이면) 랭킹.
 * withRanking=false면 players 없이 방 정보만 돌려준다.
 */
async function collectRooms(getDoc, seriesName, knownIds, { withRanking }) {
  const { roomNo, found, unmatched, ids } = await searchRooms(getDoc, seriesName, knownIds);
  const rooms = [];
  const errors = [];
  for (const compeId of ids) {
    try {
      const { doc: detail } = await getDoc(`/compe_detail.php?compeid=${compeId}`);
      const fields = parseCompeDetail(detail);
      const name = found.get(compeId) ?? fields['大会名'] ?? '';
      const no = roomNo(name);
      if (!no) {
        errors.push(`대회 ${compeId}: 이름이 형식과 맞지 않아 제외 (${name || '이름 없음'})`);
        continue;
      }
      const room = {
        compeId,
        no: Number(no),
        name,
        host: (fields['主催'] ?? '').trim(),
        members: (fields['人数'] ?? '').trim(),
      };
      if (withRanking) {
        const { doc: ranking } = await getDoc(`/compe_ranking.php?compeid=${compeId}`);
        Object.assign(room, parseCompeRanking(ranking));
      }
      rooms.push(room);
    } catch (error) {
      errors.push(`대회 ${compeId}: ${error?.message ?? error}`);
    }
  }

  if (rooms.length === 0) {
    // 이름이 틀렸을 때 빈 데이터를 게시해 사이트를 지우지 않도록 여기서 멈춘다.
    const hint = unmatched.size ? ` 검색된 대회: ${[...unmatched].slice(0, 5).join(', ')}` : ' 검색 결과가 없습니다.';
    throw new CollectError('NO_ROOMS', `"${seriesName}" #번호 형식의 대회를 찾지 못했습니다.${hint}`);
  }

  rooms.sort((a, b) => a.no - b.no);
  return { rooms, errors, collectedAt: Date.now() };
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

/** 수집할 대회 목록: { id, file, data } */
async function findTargets(now) {
  const index = await readJson(path.join(ROOT, 'events/index.json'));
  const wanted = env.EVENT?.trim();
  const events = (index.events ?? []).filter((ev) => (wanted ? ev.id === wanted : ev.status === 'qualifier'));
  if (wanted && events.length === 0) throw new CollectError('CONFIG', `events/index.json에 "${wanted}" 대회가 없습니다.`);

  const targets = [];
  for (const ev of events) {
    const file = path.join(ROOT, 'events', ev.id, 'qualifier.json');
    let data;
    try {
      data = await readJson(file);
    } catch {
      log(`- ${ev.id}: qualifier.json이 없어 건너뜀`);
      continue;
    }
    const { config } = data;
    if (!config?.name?.trim() || !config.startDate) {
      log(`- ${ev.id}: config.name / startDate가 없어 건너뜀`);
      continue;
    }
    if (env.FORCE !== '1') {
      const [y, m, d] = config.startDate.split('-').map(Number);
      const start = new Date(y, m - 1, d, 5).getTime();
      const end = finalizeAt(config);
      if (now < start) {
        log(`- ${ev.id}: 예선 시작 전 (${config.startDate})`);
        continue;
      }
      if (end && (data.snapshots?.[0]?.collectedAt ?? 0) >= end) {
        log(`- ${ev.id}: 최종 집계가 끝나 건너뜀`);
        continue;
      }
    }
    targets.push({ id: ev.id, file, data });
  }
  return targets;
}

async function withRetry(label, fn) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!error?.retryable || attempt >= ATTEMPTS) throw error;
      log(`  ${label} 실패 (${error.message}) → ${RETRY_DELAY_MS / 1000}초 후 재시도 ${attempt + 1}/${ATTEMPTS}`);
      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function main() {
  const mode = MODE;
  if (!['ranking', 'members'].includes(mode)) throw new CollectError('CONFIG', `알 수 없는 MODE: ${mode}`);
  const salt = env.HIROBA_ID_SALT?.trim();
  if (mode === 'ranking' && !salt) {
    throw new CollectError('CONFIG', 'HIROBA_ID_SALT 시크릿이 없습니다. 확장의 playerIdSalt 값을 넣어 주세요.');
  }

  const targets = (await findTargets(Date.now())).filter(({ id, data }) => {
    if (mode === 'members' && !data.snapshots?.length) {
      log(`- ${id}: 아직 순위 스냅샷이 없어 인원 갱신을 건너뜀`);
      return false;
    }
    return true;
  });
  if (targets.length === 0) {
    log('수집할 대회가 없습니다.');
    summary.push('수집할 대회 없음');
    return 0;
  }

  let getDoc = makeClient(await withRetry('로그인', login));
  let failures = 0;

  for (const { id, file, data } of targets) {
    log(`▶ ${id} [${mode}]: "${data.config.name}"`);
    try {
      const knownIds = [...new Set((data.snapshots ?? []).flatMap((s) => s.rooms.map((r) => String(r.compeId))))];
      const collected = await withRetry('수집', async () => {
        try {
          return await collectRooms(getDoc, data.config.name, knownIds, { withRanking: mode === 'ranking' });
        } catch (error) {
          if (error.code === 'NOT_LOGGED_IN') getDoc = makeClient(await login());
          throw error;
        }
      });

      const result = mode === 'ranking' ? applyRanking(data, collected, salt) : applyMembers(data, collected);
      const line = `${id}: ${result.line}${result.errors.length ? ` · 경고 ${result.errors.length}건` : ''}`;
      result.errors.forEach((e) => log(`  ⚠ ${e}`));

      if (!result.changed) {
        log(`  = ${line}`);
        summary.push(`➖ ${line}`);
      } else if (env.DRY_RUN === '1') {
        log(`  (DRY_RUN) ${line}`);
        summary.push(`🔍 ${line} (DRY_RUN, 저장 안 함)`);
      } else {
        await writeFile(file, `${JSON.stringify(result.next, null, 1)}\n`);
        log(`  ✔ ${line}`);
        summary.push(`✅ ${line}`);
      }
    } catch (error) {
      failures += 1;
      log(`::error title=${id} 수집 실패::[${error.code ?? 'ERROR'}] ${error.message}`);
      summary.push(`❌ ${id}: [${error.code ?? 'ERROR'}] ${error.message}`);
    }
  }
  return failures ? 1 : 0;
}

const code = await main().catch((error) => {
  log(`::error title=수집 중단::[${error.code ?? 'ERROR'}] ${error.message}`);
  summary.push(`❌ [${error.code ?? 'ERROR'}] ${error.message}`);
  return 1;
});
if (env.GITHUB_STEP_SUMMARY) {
  await appendFile(env.GITHUB_STEP_SUMMARY, `## ${MODE === 'members' ? '인원' : '순위'} 집계\n\n${summary.map((s) => `- ${s}`).join('\n')}\n`);
}
process.exitCode = code;
