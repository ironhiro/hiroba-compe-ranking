import '../components/qualifier-board.js';
import '../components/bracket-view.js';
import { applyEventHeader, currentEventId, escapeHtml, eventPath, loadJson } from '../core/data.js';

// 단계 종류 → 컴포넌트 태그. 새 단계 종류는 컴포넌트를 만들고 여기에 등록한다.
const STAGE_COMPONENTS = Object.freeze({
  qualifier: 'qualifier-board',
  bracket: 'bracket-view',
});

const els = {
  logo: document.getElementById('logo'),
  title: document.getElementById('title'),
  subtitle: document.getElementById('subtitle'),
  tabs: document.getElementById('tabs'),
  stage: document.getElementById('stage'),
};

let event = null;

function pickStage() {
  const stages = event.stages ?? [];
  const wanted = location.hash.slice(1) || event.defaultStage;
  return stages.find((stage) => stage.id === wanted) ?? stages[0] ?? null;
}

function renderStage() {
  const stage = pickStage();
  for (const tab of els.tabs.querySelectorAll('a')) {
    tab.setAttribute('aria-current', tab.dataset.stage === stage?.id ? 'page' : 'false');
  }
  const tag = STAGE_COMPONENTS[stage?.type];
  if (!stage || !tag) {
    els.stage.innerHTML = '<p class="empty">표시할 단계가 없습니다.</p>';
    return;
  }
  const element = document.createElement(tag);
  element.setAttribute('src', eventPath(event.id, stage.src));
  els.stage.replaceChildren(element);
}

async function main() {
  const eventId = currentEventId();
  if (!eventId) {
    els.stage.innerHTML = '<p class="empty">대회를 찾을 수 없습니다. <a href="./">대회 목록</a>에서 선택해 주세요.</p>';
    return;
  }
  try {
    event = { id: eventId, ...(await loadJson(eventPath(eventId, 'event.json'))) };
    applyEventHeader(event, els);
    // 대회 전용 페이지는 <base href="../">를 쓰므로 "#id"만 쓰면 사이트 루트로 이동한다.
    const here = escapeHtml(`${location.pathname}${location.search}`);
    els.tabs.innerHTML = (event.stages ?? [])
      .map((stage) => `<a href="${here}#${escapeHtml(stage.id)}" data-stage="${escapeHtml(stage.id)}">${escapeHtml(stage.title)}</a>`)
      .join('');
    els.tabs.hidden = (event.stages ?? []).length < 2;
    renderStage();
    window.addEventListener('hashchange', renderStage);
  } catch (error) {
    els.stage.innerHTML = `<p class="empty">${escapeHtml(error?.message ?? error)}</p>`;
  }
}

main();
