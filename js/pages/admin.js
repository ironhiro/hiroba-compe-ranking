import '../components/bracket-view.js';
import { buildStandings } from '../components/qualifier-board.js';
import {
  BRACKET_SIZES,
  clearResult,
  deriveBracket,
  emptyBracket,
  normalizeBracket,
  pruneStale,
  setResult,
} from '../core/bracket.js';
import {
  applyEventHeader,
  currentEventId,
  escapeHtml,
  eventPath,
  loadJson,
  loadOptionalJson,
} from '../core/data.js';
import { forgetSettings, isReady, loadSettings, readJson, saveSettings, writeJson } from '../core/github.js';

const $ = (id) => document.getElementById(id);
const els = Object.fromEntries([
  'logo', 'title', 'connect', 'connectState', 'owner', 'repo', 'branch', 'token', 'connectBtn', 'forgetBtn',
  'stageSelect', 'size', 'thirdPlace', 'placedInfo', 'fillRank', 'shuffle', 'clearEntrants', 'playerNames',
  'entrants', 'entrantWarn', 'results', 'preview', 'saveState', 'download', 'publish',
].map((id) => [id, $(id)]));

const state = {
  eventId: null,
  event: null,
  stage: null,
  bracket: emptyBracket(),
  sha: null,
  dirty: false,
  rankedNames: [],
  settings: loadSettings(),
};

// ---------- 공통 ----------

const setSaveState = (text, kind = '') => {
  els.saveState.textContent = text;
  els.saveState.className = kind;
};

const markDirty = () => {
  state.dirty = true;
  setSaveState('저장 안 된 변경 있음', 'warn');
};

const bracketPath = () => eventPath(state.eventId, state.stage.src);

function shuffled(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ---------- 렌더링 ----------

function renderConnect() {
  const { owner, repo, branch, token } = state.settings;
  els.owner.value = owner ?? '';
  els.repo.value = repo ?? '';
  els.branch.value = branch ?? 'main';
  els.token.value = token ?? '';
  const ready = isReady(state.settings);
  els.connectState.textContent = ready ? '연결 정보 있음' : '미연결';
  els.connectState.classList.toggle('ok', ready);
  els.connect.open = !ready;
}

function renderSettings() {
  els.size.value = String(state.bracket.size);
  els.thirdPlace.checked = state.bracket.thirdPlace;
}

function renderEntrants() {
  const { entrants } = state.bracket;
  const rows = [];
  for (let m = 0; m < entrants.length / 2; m += 1) {
    const slot = (i) => `
      <label class="slot"><span>${i + 1}</span>
        <input data-slot="${i}" list="playerNames" value="${escapeHtml(entrants[i])}" placeholder="선수 이름" autocomplete="off">
      </label>`;
    rows.push(`<div class="entrant-match"><b>${m + 1}경기</b>${slot(m * 2)}<em>vs</em>${slot(m * 2 + 1)}</div>`);
  }
  els.entrants.innerHTML = rows.join('');
  updateEntrantInfo();
}

function updateEntrantInfo() {
  const names = state.bracket.entrants.filter(Boolean);
  els.placedInfo.textContent = `${names.length} / ${state.bracket.size}명 배치`;
  const counts = names.reduce((map, name) => map.set(name, (map.get(name) ?? 0) + 1), new Map());
  const dupes = [...counts].filter(([, n]) => n > 1).map(([name]) => name);
  els.entrantWarn.textContent = dupes.length ? `중복 배치: ${dupes.join(', ')}` : '';
}

function renderMatchEditor(match, title) {
  const [a, b] = match.players;
  const r = match.result;
  const disabled = match.ready ? '' : 'disabled';
  const radio = (side, name) => `
    <label class="pick"><input type="radio" name="w-${match.key}" value="${side}" ${r?.winner === side ? 'checked' : ''} ${name ? '' : 'disabled'} ${disabled}>
      <span>${name ? escapeHtml(name) : '미정'}</span></label>`;
  const score = (side) => `<input class="score" type="number" inputmode="numeric" min="0" data-score="${side}"
      value="${r?.scores?.[side] ?? ''}" placeholder="점수" ${disabled}>`;
  return `
    <div class="match-editor${r ? ' done' : ''}${match.stale ? ' stale' : ''}" data-key="${escapeHtml(match.key)}">
      <span class="label">${escapeHtml(title)}</span>
      <div class="sides">
        <div class="side-edit">${radio(0, a)}${score(0)}</div>
        <div class="side-edit">${radio(1, b)}${score(1)}</div>
      </div>
      <input class="note" data-note value="${escapeHtml(r?.note ?? '')}" placeholder="메모 (기권, 부전승 등)" ${disabled}>
      <div class="row-actions">
        <button type="button" data-action="apply" ${disabled}>적용</button>
        <button type="button" class="ghost" data-action="clear" ${r || match.stale ? '' : 'disabled'}>지우기</button>
      </div>
      ${match.stale ? '<p class="warn">앞 경기 결과가 바뀌어 이 결과는 무효입니다. 다시 입력하거나 지워 주세요.</p>' : ''}
    </div>`;
}

function renderResults() {
  const derived = deriveBracket(state.bracket);
  const sections = derived.rounds.map((round) => `
    <h3>${escapeHtml(round.name)}</h3>
    <div class="match-editors">${round.matches.map((m) => renderMatchEditor(m, `${round.name} ${m.index + 1}경기`)).join('')}</div>`);
  if (derived.thirdPlace) {
    sections.push(`<h3>3·4위전</h3><div class="match-editors">${renderMatchEditor(derived.thirdPlace, '3·4위전')}</div>`);
  }
  els.results.innerHTML = sections.join('');
}

function renderPreview() {
  els.preview.data = state.bracket;
}

function renderAll() {
  renderSettings();
  renderEntrants();
  renderResults();
  renderPreview();
}

// ---------- 데이터 ----------

async function loadBracket() {
  if (isReady(state.settings)) {
    const { json, sha } = await readJson(state.settings, bracketPath());
    state.sha = sha;
    return json;
  }
  state.sha = null;
  return loadOptionalJson(bracketPath());
}

async function loadQualifierNames() {
  const qualifier = (state.event.stages ?? []).find((s) => s.type === 'qualifier');
  if (!qualifier) return;
  const data = await loadOptionalJson(eventPath(state.eventId, qualifier.src)).catch(() => null);
  const [latest, previous] = data?.snapshots ?? [];
  if (!latest) return;
  const { ranked } = buildStandings(latest, data.config, previous);
  state.rankedNames = ranked.map((p) => p.name);
  els.playerNames.innerHTML = ranked
    .map((p) => `<option value="${escapeHtml(p.name)}">${p.rank}위${p.qualified ? ' · 통과' : p.reserve ? ' · 후보' : ''}</option>`)
    .join('');
}

async function selectStage(stageId) {
  state.stage = (state.event.stages ?? []).find((s) => s.id === stageId);
  const json = await loadBracket();
  state.bracket = normalizeBracket(json ?? emptyBracket());
  state.dirty = false;
  setSaveState(json ? '불러옴' : '새 대진표 (아직 파일 없음)');
  renderAll();
}

// ---------- 이벤트 ----------

const onConnect = async () => {
  state.settings = {
    owner: els.owner.value.trim(),
    repo: els.repo.value.trim(),
    branch: els.branch.value.trim() || 'main',
    token: els.token.value.trim(),
  };
  saveSettings(state.settings);
  renderConnect();
  if (!isReady(state.settings)) return;
  try {
    if (state.dirty) {
      // 입력 중인 내용은 유지하고 저장에 필요한 sha만 받아 온다.
      state.sha = (await readJson(state.settings, bracketPath())).sha;
      setSaveState('연결됨 · 입력 중인 내용 유지', 'warn');
    } else {
      await selectStage(state.stage.id);
      setSaveState('GitHub에서 최신 내용을 불러왔습니다', 'ok');
    }
  } catch (error) {
    setSaveState(String(error?.message ?? error), 'err');
  }
};

const onForget = () => {
  forgetSettings();
  state.settings = loadSettings();
  renderConnect();
};

const onSettingsChange = (event) => {
  if (event.target === els.stageSelect) {
    if (state.dirty && !window.confirm('저장하지 않은 변경이 사라집니다. 단계를 바꿀까요?')) {
      els.stageSelect.value = state.stage.id;
      return;
    }
    selectStage(els.stageSelect.value).catch((error) => setSaveState(String(error?.message ?? error), 'err'));
    return;
  }
  if (event.target === els.size) {
    const size = Number(els.size.value);
    const entrants = Array.from({ length: size }, (_, i) => state.bracket.entrants[i] ?? '');
    state.bracket = pruneStale({ ...state.bracket, size, entrants });
  } else if (event.target === els.thirdPlace) {
    state.bracket = { ...state.bracket, thirdPlace: els.thirdPlace.checked };
  }
  markDirty();
  renderAll();
};

const onEntrantInput = (event) => {
  const slot = event.target.dataset?.slot;
  if (slot === undefined) return;
  const entrants = [...state.bracket.entrants];
  entrants[Number(slot)] = event.target.value.trim();
  state.bracket = { ...state.bracket, entrants };
  markDirty();
  updateEntrantInfo();
  if (event.type === 'change') {
    renderResults();
    renderPreview();
  }
};

const setEntrants = (entrants) => {
  state.bracket = { ...state.bracket, entrants };
  markDirty();
  renderAll();
};

const onFillRank = () => {
  if (state.rankedNames.length === 0) {
    setSaveState('예선 데이터가 없습니다.', 'err');
    return;
  }
  setEntrants(Array.from({ length: state.bracket.size }, (_, i) => state.rankedNames[i] ?? ''));
};

const onShuffle = () => {
  const names = shuffled(state.bracket.entrants.filter(Boolean));
  setEntrants(Array.from({ length: state.bracket.size }, (_, i) => names[i] ?? ''));
};

const onClearEntrants = () => {
  if (window.confirm('대진 배치를 모두 비울까요? (경기 결과도 무효가 됩니다)')) {
    setEntrants(Array(state.bracket.size).fill(''));
  }
};

const onResultsClick = (event) => {
  const action = event.target.dataset?.action;
  const editor = event.target.closest('.match-editor');
  if (!action || !editor) return;
  const key = editor.dataset.key;
  if (action === 'clear') {
    state.bracket = clearResult(state.bracket, key);
  } else {
    const derived = deriveBracket(state.bracket);
    const match = [...derived.rounds.flatMap((r) => r.matches), derived.thirdPlace].find((m) => m?.key === key);
    const picked = editor.querySelector('input[type="radio"]:checked');
    if (!match || !picked) {
      setSaveState('승자를 선택해 주세요.', 'err');
      return;
    }
    const scoreOf = (side) => {
      const raw = editor.querySelector(`[data-score="${side}"]`).value.trim();
      return raw === '' ? null : Number(raw);
    };
    state.bracket = setResult(state.bracket, match, {
      winner: Number(picked.value),
      scores: [scoreOf(0), scoreOf(1)],
      note: editor.querySelector('[data-note]').value.trim(),
    });
  }
  markDirty();
  renderResults();
  renderPreview();
};

const finalBracket = () => ({ ...pruneStale(state.bracket), updatedAt: Date.now() });

const onPublish = async () => {
  if (!isReady(state.settings)) {
    els.connect.open = true;
    setSaveState('먼저 GitHub 연결 정보를 입력해 주세요.', 'err');
    return;
  }
  els.publish.disabled = true;
  setSaveState('게시 중…');
  try {
    const bracket = finalBracket();
    state.sha = await writeJson(state.settings, bracketPath(), bracket, state.sha, `bracket: ${state.eventId}/${state.stage.id} ${new Date().toISOString()}`);
    state.bracket = bracket;
    state.dirty = false;
    renderAll();
    setSaveState('게시했습니다. 사이트 반영까지 1~2분 걸릴 수 있습니다.', 'ok');
  } catch (error) {
    setSaveState(String(error?.message ?? error), 'err');
  } finally {
    els.publish.disabled = false;
  }
};

const onDownload = () => {
  const blob = new Blob([`${JSON.stringify(finalBracket(), null, 1)}\n`], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${state.eventId}-${state.stage.id}-bracket.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};

const onBeforeUnload = (event) => {
  if (state.dirty) event.preventDefault();
};

// ---------- 시작 ----------

async function main() {
  state.eventId = currentEventId();
  if (!state.eventId) {
    document.querySelector('main').innerHTML = '<p class="empty">주소에 ?e=대회id 가 필요합니다.</p>';
    return;
  }
  state.event = await loadJson(eventPath(state.eventId, 'event.json'));
  applyEventHeader(state.event, els);
  els.title.textContent = `${state.event.name ?? state.eventId} · 본선 관리`;

  const bracketStages = (state.event.stages ?? []).filter((s) => s.type === 'bracket');
  if (bracketStages.length === 0) {
    document.querySelector('main').innerHTML = '<p class="empty">event.json에 bracket 단계가 없습니다.</p>';
    return;
  }
  els.stageSelect.innerHTML = bracketStages.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.title)}</option>`).join('');
  els.size.innerHTML = BRACKET_SIZES.map((n) => `<option value="${n}">${n}명</option>`).join('');

  renderConnect();
  await loadQualifierNames();
  await selectStage(bracketStages[0].id);

  els.connectBtn.addEventListener('click', onConnect);
  els.forgetBtn.addEventListener('click', onForget);
  for (const el of [els.stageSelect, els.size, els.thirdPlace]) el.addEventListener('change', onSettingsChange);
  els.entrants.addEventListener('input', onEntrantInput);
  els.entrants.addEventListener('change', onEntrantInput);
  els.fillRank.addEventListener('click', onFillRank);
  els.shuffle.addEventListener('click', onShuffle);
  els.clearEntrants.addEventListener('click', onClearEntrants);
  els.results.addEventListener('click', onResultsClick);
  els.publish.addEventListener('click', onPublish);
  els.download.addEventListener('click', onDownload);
  window.addEventListener('beforeunload', onBeforeUnload);
}

main().catch((error) => setSaveState(String(error?.message ?? error), 'err'));
