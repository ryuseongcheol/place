import { requestBudget } from "./budget";
import { fetchKakaoReviews, searchKakao } from "./kakao";
import { mockKakao, mockPlaces } from "./mock";
import { isMockMode } from "./recommend";
import type { BasePlace, LatLng, ScoredPlace } from "./types";
import { mapLimit, nameSimilarity, normalizeName } from "./util";

/**
 * 가게 이름으로 찾기 (상단 검색창). 카카오 공식 키워드 검색으로 20km 안 음식점·카페를 찾고,
 * 이름이 맞는 곳만 가까운 순으로. 위쪽 몇 곳은 카카오 별점·후기 수도 붙인다.
 * strong: 이름이 확실히 맞는 곳이 있는지 (없으면 앱은 기존 추천 검색으로)
 */
export async function searchByName(q: string, loc: LatLng): Promise<{ places: ScoredPlace[]; strong: boolean }> {
  const nq = normalizeName(q);
  if (nq.length < 2) return { places: [], strong: false };
  const budget = requestBudget();
  let found: BasePlace[];
  if (isMockMode()) {
    found = mockPlaces(loc, [q]).filter((p) => normalizeName(p.name).includes(nq));
  } else {
    const [fd, ce] = await Promise.all([searchKakao(q, loc, 20000, "FD6", 1, budget), searchKakao(q, loc, 20000, "CE7", 1, budget)]);
    const seen = new Set<string>();
    found = [...fd, ...ce].filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  }
  const scored = found
    .map((p) => {
      const n = normalizeName(p.name);
      const sim = nameSimilarity(q, p.name);
      // "국밥"처럼 업종 이름으로 찾은 것은 이름 검색으로 보지 않는다
      const isCategoryWord = normalizeName(p.category).includes(nq);
      const strong = !isCategoryWord && (n.startsWith(nq) || sim >= 0.85);
      return { p, strong, ok: n.includes(nq) || sim >= 0.6 };
    })
    .filter((x) => x.ok)
    .sort((a, b) => Number(b.strong) - Number(a.strong) || a.p.distance - b.p.distance)
    .slice(0, 15);

  // 위쪽 8곳은 카카오 별점·후기 수 (비공식 상세, 예산 안에서)
  const infos = await mapLimit(scored.slice(0, 8), 4, async ({ p }) =>
    isMockMode() ? mockKakao(p.id) : budget.remaining > 0 ? await fetchKakaoReviews(p.id, budget).catch(() => null) : null,
  );
  const places: ScoredPlace[] = scored.map(({ p }, i) => ({
    ...p,
    kakao: infos[i] ?? null,
    naver: null,
    score: 0,
    scoreBreakdown: { rating: 0, popularity: 0, relevance: 0, distance: 0 },
    reason: `'${q}' 이름으로 찾은 곳이에요.`,
    highlights: (infos[i]?.tags ?? []).slice(0, 3),
    aiRanked: false,
  }));
  return { places, strong: scored.some((x) => x.strong) };
}
