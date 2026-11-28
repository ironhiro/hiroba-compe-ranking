# hiroba-compe-ranking

동더히로바 대회의 **예선 순위**(히로바 여러 방 랭킹 합산)와 **본선 대진표**를 보여주는 정적 사이트입니다.
빌드 없이 GitHub Pages에서 그대로 동작하고, 대회마다 폴더 하나를 추가하는 방식으로 여러 대회에 재사용합니다.

## 구조

```
index.html                대회 목록 (events/index.json)
event.html?e=<id>         대회 페이지 — 단계(예선/본선) 탭
admin.html?e=<id>         운영자용 본선 관리 (대진 배치·결과 입력 → GitHub 커밋)

js/core/                  공용 로직
  data.js                 경로·로딩·포맷터
  bracket.js              대진표 모델 (순수 함수)
  github.js               GitHub Contents API (관리 페이지용)
js/components/            공용 컴포넌트 (Custom Elements)
  qualifier-board.js      <qualifier-board src="…">  예선 순위표
  bracket-view.js         <bracket-view src="…">     대진표
js/pages/                 페이지 스크립트
css/                      style.css(공통·예선) · bracket.css · admin.css

events/index.json         대회 목록
events/<id>/event.json    대회 설정 (이름, 단계)
events/<id>/qualifier.json  예선 데이터 — GitHub Actions가 커밋 (아래 "자동 수집")

collector/                히로바 수집 스크립트 (Node, GitHub Actions에서 실행)
.github/workflows/        collect-ranking.yml(매일 순위) · collect-members.yml(매시간 인원)
events/<id>/bracket.json    본선 데이터 — 관리 페이지에서 커밋
```

## 새 대회 추가
1. `events/<id>/event.json` 작성 (`id`는 영소문자·숫자·하이픈)
   ```json
   {
     "name": "붕오떡컵",
     "description": "예선 11/26 ~ 12/5 · 본선 12/14",
     "logo": "events/<id>/logo.png",
     "theme": { "brand": "#45a5db", "ink": "#035778" },
     "stages": [
       { "id": "qualifier", "type": "qualifier", "title": "예선", "src": "qualifier.json" },
       { "id": "main", "type": "bracket", "title": "본선", "src": "bracket.json" }
     ],
     "defaultStage": "qualifier"
   }
   ```
   단계는 필요한 만큼 추가할 수 있습니다(예: 예선만 있는 대회, 본선이 둘인 대회).
2. `events/index.json`의 `events`에 `{ "id", "name", "period", "status" }` 추가
   (`status`: `upcoming` · `qualifier` · `main` · `finished`, 목록에서 숨기려면 `"hidden": true`)
3. `events/<id>/qualifier.json`에 `config`만 넣어 둔다 (`snapshots`는 빈 배열). `status`가 `qualifier`인 동안 자동 수집됩니다.
   ```json
   { "schema": 1, "config": { "name": "붕오떡컵 예선", "startDate": "2026-12-10", "days": 10, "cutoff": 16, "reserves": 2, "refreshTime": "10:30" }, "snapshots": [] }
   ```
   `name`은 히로바 방 이름에서 " #번호" 앞부분 전체입니다.
4. `python tools/build_pages.py` 실행 → 대회 전용 주소 `<id>/` 생성 (아래 "공유 썸네일")

새 단계 종류가 필요하면 `js/components/`에 컴포넌트를 만들고 `js/pages/event.js`의 `STAGE_COMPONENTS`에 등록합니다.

## 예선
- 상위 N위 **예선 유력**(마지막 날 반영 후 **예선 확정**), 다음 M명 **후보**(취소 시 대체), 점수 미등록은 **순위 미정**
- 전날 대비 순위 변동, 컷까지 남은 점수, 곡별 점수
- 공개되는 값은 방 정보·플레이어 이름·점수뿐이고, 태고 번호는 해시로 바꿔 올립니다.

## 본선 (관리 페이지)
`admin.html?e=<id>` — 현장 운영자가 노트북이나 폰에서 사용합니다.
- 대진 배치: 칸마다 선수 입력(예선 통과자·후보 자동완성), 무작위 섞기, 4~64명, 3·4위전 선택
- 결과 입력: 승자·점수·메모(기권, 부전승 등) → 다음 라운드 자동 진출
- 앞 경기 결과를 바꾸면 영향받는 뒤 경기 결과는 무효로 표시되고, 게시할 때 정리됩니다.
- **GitHub에 게시**: 연결 정보(owner/repo/branch/토큰)를 넣으면 `bracket.json`을 커밋합니다.
  토큰은 그 브라우저 localStorage에만 저장됩니다. 공용 PC면 작업 후 "토큰 지우기".
  다른 사람이 먼저 저장했으면 덮어쓰지 않고 다시 불러오라고 알려줍니다.
- 토큰이 없을 때는 **JSON 내려받기** 후 직접 커밋해도 됩니다.

## 자동 수집 (GitHub Actions)
| 워크플로 | 시각 (KST) | 하는 일 |
|---|---|---|
| `collect-ranking.yml` | 매일 10:30 (히로바 기록 갱신 10:00 이후) | 방 검색 → 상세 → 랭킹, 게임 일자별 스냅샷 추가 (최신 + 전날만 유지) |
| `collect-members.yml` | 매시간 05분 | 최신 스냅샷의 방 인원·주최만 갱신, 새 방 추가. 바뀐 게 있을 때만 커밋 |

- 예약 실행은 GitHub 사정으로 수~수십 분 늦을 수 있습니다. Actions 탭 → 워크플로 → **Run workflow**로 바로 돌릴 수 있습니다(`dry_run`: 저장 없이 확인, `force`: 기간 밖에도 실행).
- 방이 하나도 안 잡히면(이름 오입력 등) 게시하지 않고 실패로 끝납니다.
- 예선 시작 전, 최종 집계(종료 다음 날 갱신 시각) 이후에는 자동으로 건너뜁니다.

**Secrets** (Settings → Secrets and variables → Actions)
| 이름 | 내용 |
|---|---|
| `HIROBA_EMAIL` · `HIROBA_PASSWORD` | 반다이남코 ID. 운영 전용 부계정 권장 |
| `HIROBA_ID_SALT` | 플레이어 ID 해시용 salt. 확장의 `playerIdSalt`와 같아야 기존 데이터와 ID가 이어집니다 |
| `HIROBA_TAIKO_NO` | (선택) 로그인할 카드의 태고 번호. 없으면 첫 카드 |

이 레포는 Public이라 Actions 로그도 공개됩니다. 스크립트는 로그인 중 콘솔 출력을 막고 세션 토큰을 마스킹합니다. 로그에 계정 정보를 찍는 코드를 넣지 마세요.

로그인·수집에는 [hiroba-js](https://github.com/hotsixman/hiroba.js) (MIT)를 씁니다.

## 배포
1. 이 폴더를 GitHub 레포로 올리고 Settings → Pages → `main` / `/ (root)`
2. Fine-grained 토큰: 이 레포만, **Contents: Read and write** (관리 페이지용)
3. GitHub Pages는 최대 10분 정도 캐시될 수 있어, 게시 직후 바로 안 바뀌어 보일 수 있습니다.

## 로고와 색
로고는 바뀔 수 있으므로 색은 CSS에 고정하지 않고 대회 설정에서 정합니다.

- `event.json`의 `logo`: 대회 로고 경로 (보통 `events/<id>/logo.png`, 없으면 사이트 로고 `assets/site-logo.svg`)
- 대회 목록(최상위) 페이지는 사이트 로고 `assets/site-logo.svg`·`.png`를 씁니다.
- `event.json`의 `theme`: 기준색 2개만 지정
  - `brand`: 페이지 배경·강조색 (보통 로고 배경색)
  - `ink`: 테두리·진한 강조색 (흰 바탕에서 읽히는 진한 색)
  - `onBrand`(선택): brand 위 글자색을 직접 지정할 때
- 옅은 배경·구분선·보조 글자색은 두 색에서 자동 계산(`color-mix`)하고,
  brand 위 글자는 밝기에 따라 흰색/진한색을 자동으로 고릅니다.
- 순위 상승·하락, 후보(노랑), 우승(금색) 같은 의미색은 테마와 무관하게 고정입니다.
- 대회 목록 페이지 색은 `events/index.json`의 `theme`로 정합니다.

## 공유 썸네일
카카오톡·디스코드 같은 링크 미리보기는 JS를 실행하지 않아서, 메타 태그가 HTML에 고정돼 있어야 합니다.
`python tools/build_pages.py`가 다음을 채웁니다.

- `index.html`: 사이트 이름·설명(`events/index.json`의 `site`)과 기본 로고
- `<id>/index.html`: 대회마다 하나씩 만드는 전용 페이지. 제목·설명은 `event.json`, 썸네일은 대회 `logo`
  (png/jpg만 됨. 없거나 svg면 사이트 로고 `assets/site-logo.png`)
- 공유할 때는 `https://…/hiroba-compe-ranking/<id>/` 주소를 씁니다. `event.html?e=<id>`도 그대로 동작하지만 썸네일은 기본값입니다.
- 대회를 추가하거나 이름·설명·로고를 바꾸면 다시 실행해서 커밋합니다. `<id>/index.html`은 직접 고치지 말고 `event.html`을 고칩니다.
- 같은 스크립트가 js·css 주소 뒤에 내용 해시(`?v=`)를 붙입니다. GitHub Pages가 파일을 10분 캐시해서, 새 HTML이 예전 JS와 섞여 화면이 안 뜨는 걸 막기 위해서입니다. **js·css를 고친 뒤에도 반드시 다시 실행**하세요.
- 카카오톡은 미리보기를 캐시하므로, 바꾼 뒤에도 예전 썸네일이 보이면 카카오 개발자 도구의 공유 디버거에서 캐시를 지웁니다.

## 로컬 미리보기
```
python -m http.server 8765
```
`http://localhost:8765/event.html?e=demo` — 가상 데이터로 만든 데모 대회(목록에는 숨김)
