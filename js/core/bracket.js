// 싱글 엘리미네이션 대진표 모델 (순수 함수)
//
// 저장 형식 (events/<id>/bracket.json)
// {
//   schema: 1,
//   size: 16,                       // 2의 거듭제곱
//   entrants: ["이름", ...],        // 1라운드 배치 순서. 매치 m = entrants[2m] vs entrants[2m+1]
//   results: { "0-3": { players: [a, b], scores: [x, y], winner: 0|1, note: "" }, "third": {...} },
//   thirdPlace: false,              // 3·4위전 여부
//   updatedAt: 1764000000000
// }
// 결과에는 입력 당시의 두 선수 이름을 같이 저장한다. 앞 라운드 결과가 바뀌어 대진이 달라지면
// 그 결과는 자동으로 무효(stale) 처리되어 다시 입력하게 된다.

export const BRACKET_SIZES = Object.freeze([4, 8, 16, 32, 64]);
export const THIRD_PLACE_KEY = 'third';

export const resultKey = (round, index) => `${round}-${index}`;

export function roundName(playersInRound) {
  if (playersInRound === 2) return '결승';
  if (playersInRound === 4) return '준결승';
  return `${playersInRound}강`;
}

export function emptyBracket(size = 16) {
  return { schema: 1, size, entrants: Array(size).fill(''), results: {}, thirdPlace: false, updatedAt: null };
}

/** 저장된 데이터를 크기에 맞게 정리 */
export function normalizeBracket(raw) {
  const size = BRACKET_SIZES.includes(Number(raw?.size)) ? Number(raw.size) : 16;
  const entrants = Array.from({ length: size }, (_, i) => String(raw?.entrants?.[i] ?? '').trim());
  return {
    schema: 1,
    size,
    entrants,
    results: raw?.results && typeof raw.results === 'object' ? raw.results : {},
    thirdPlace: Boolean(raw?.thirdPlace),
    updatedAt: raw?.updatedAt ?? null,
  };
}

function resolveMatch(key, players, stored) {
  const ready = players.some(Boolean);
  const valid = Boolean(stored)
    && (stored.winner === 0 || stored.winner === 1)
    && Boolean(players[stored.winner])
    && stored.players?.[0] === players[0]
    && stored.players?.[1] === players[1];
  const result = valid ? stored : null;
  return {
    key,
    players,
    ready,
    result,
    stale: Boolean(stored) && !valid,
    winner: result ? players[result.winner] : null,
    loser: result ? players[1 - result.winner] || null : null,
  };
}

/** 라운드별 매치, 우승·준우승·3위를 계산한다. */
export function deriveBracket(rawBracket) {
  const bracket = normalizeBracket(rawBracket);
  const rounds = [];
  let previous = null;
  for (let playersInRound = bracket.size, round = 0; playersInRound >= 2; playersInRound /= 2, round += 1) {
    const matchCount = playersInRound / 2;
    const matches = Array.from({ length: matchCount }, (_, index) => {
      const players = previous
        ? [previous[index * 2].winner ?? '', previous[index * 2 + 1].winner ?? '']
        : [bracket.entrants[index * 2], bracket.entrants[index * 2 + 1]];
      const key = resultKey(round, index);
      return { ...resolveMatch(key, players, bracket.results[key]), round, index };
    });
    rounds.push({ round, name: roundName(playersInRound), matches });
    previous = matches;
  }

  const final = rounds.at(-1)?.matches[0] ?? null;
  const semis = rounds.length >= 2 ? rounds.at(-2).matches : [];
  let thirdPlace = null;
  if (bracket.thirdPlace && semis.length === 2) {
    const players = [semis[0].loser ?? '', semis[1].loser ?? ''];
    thirdPlace = { ...resolveMatch(THIRD_PLACE_KEY, players, bracket.results[THIRD_PLACE_KEY]), round: -1, index: 0 };
  }

  let third = [];
  if (thirdPlace?.winner) third = [thirdPlace.winner];
  else if (!bracket.thirdPlace) third = semis.map((m) => m.loser).filter(Boolean);

  return {
    bracket,
    rounds,
    thirdPlace,
    podium: {
      champion: final?.winner ?? null,
      runnerUp: final?.loser ?? null,
      third,
    },
  };
}

/** 결과 입력/수정 (새 객체 반환) */
export function setResult(rawBracket, match, { winner, scores = [null, null], note = '' }) {
  const bracket = normalizeBracket(rawBracket);
  return {
    ...bracket,
    results: {
      ...bracket.results,
      [match.key]: { players: [...match.players], scores, winner, note },
    },
  };
}

export function clearResult(rawBracket, key) {
  const bracket = normalizeBracket(rawBracket);
  const { [key]: _removed, ...results } = bracket.results;
  return { ...bracket, results };
}

/** 무효가 된 결과 정리 */
export function pruneStale(rawBracket) {
  const derived = deriveBracket(rawBracket);
  const staleKeys = [...derived.rounds.flatMap((r) => r.matches), derived.thirdPlace]
    .filter((m) => m?.stale)
    .map((m) => m.key);
  return staleKeys.reduce((acc, key) => clearResult(acc, key), derived.bracket);
}
