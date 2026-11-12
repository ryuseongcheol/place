import { aiEnabled, parseTheme, rerank } from "./ai";
import { fetchKakaoReviews, regionName, searchKakao } from "./kakao";
import { mockKakao, mockNaver, mockPlaces } from "./mock";
import { attachNaver } from "./naver";
import { scorePlace } from "./score";
import { getPreset, heuristicQuery } from "./themes";
import type { BasePlace, KakaoReviewInfo, RecommendRequest, RecommendResponse, ScoredPlace, ThemeQuery } from "./types";
import { mapLimit } from "./util";

const MAX_DETAIL = 24; // 리뷰를 조회할 최대 후보 수 (외부 호출량 제한)
const RESULT_COUNT = 10;

export function isMockMode() {
  return process.env.MOCK_MODE === "1" || !process.env.KAKAO_REST_API_KEY;
}

export async function recommend(req: RecommendRequest): Promise<RecommendResponse> {
  const loc = { lat: req.lat, lng: req.lng };
  const radius = Math.min(5000, Math.max(200, req.radius ?? 1000));
  const preset = getPreset(req.presetId);
  const text = (req.text ?? "").trim().slice(0, 200);
  const mock = isMockMode();
  const useUnofficial = process.env.UNOFFICIAL_REVIEWS !== "0";
  const warnings: string[] = [];
  const sources: RecommendResponse["sources"] = {
    kakaoSearch: mock ? "mock" : "ok",
    kakaoReviews: mock ? "mock" : useUnofficial ? "ok" : "disabled",
    naverReviews: mock ? "mock" : useUnofficial ? "ok" : "disabled",
    ai: aiEnabled() ? "ok" : "disabled",
  };
  if (mock) warnings.push("KAKAO_REST_API_KEY가 없어 예시 데이터로 보여주고 있어요.");

  // 1) 주제 → 검색 조건 (자유 입력이 있으면 AI가 해석)
  let query: ThemeQuery;
  if (aiEnabled() && text) {
    try {
      query = await parseTheme(preset, text);
    } catch (e) {
      console.error("[ai] parseTheme", e);
      sources.ai = "partial";
      query = heuristicQuery(preset, text);
    }
  } else {
    query = heuristicQuery(preset, text);
  }

  // 2) 후보 수집 (카카오 공식 검색)
  let candidates: BasePlace[];
  let region: string | null = null;
  if (mock) {
    candidates = mockPlaces(loc, query.keywords).filter((p) => p.distance <= radius * 1.2);
  } else {
    const jobs = query.keywords.flatMap((k) => {
      const list: Promise<BasePlace[]>[] = [searchKakao(k, loc, radius, "FD6")];
      if (query.includeCafe) list.push(searchKakao(k, loc, radius, "CE7", 1));
      return list;
    });
    const [settled, reg] = await Promise.all([Promise.allSettled(jobs), regionName(loc)]);
    region = reg;
    const failures = settled.filter((s) => s.status === "rejected");
    if (failures.length === settled.length) {
      throw new Error((failures[0] as PromiseRejectedResult).reason?.message ?? "카카오 검색 실패");
    }
    if (failures.length) sources.kakaoSearch = "partial";
    candidates = mergeCandidates(settled.flatMap((s) => (s.status === "fulfilled" ? s.value : [])));
  }

  // 회피 키워드가 카테고리에 있으면 제외
  if (query.avoid.length) {
    candidates = candidates.filter((p) => !query.avoid.some((a) => a && `${p.category}`.includes(a)));
  }
  // 여러 검색어에 걸린 곳 + 정확도 순으로 상위 N개만 상세 조회
  candidates.sort((a, b) => b.matchedKeywords.length - a.matchedKeywords.length || a.searchRank - b.searchRank);
  candidates = candidates.slice(0, MAX_DETAIL);

  if (candidates.length === 0) {
    return { query, region, places: [], sources, warnings: [...warnings, "반경 안에서 조건에 맞는 식당을 찾지 못했어요. 반경을 넓혀보세요."] };
  }

  // 3) 리뷰·별점 수집 (카카오 상세 + 네이버 검색)
  const kakaoMap = new Map<string, KakaoReviewInfo | null>();
  let naverMap = new Map<string, NonNullable<ReturnType<typeof mockNaver>>>();
  if (mock) {
    for (const p of candidates) {
      kakaoMap.set(p.id, mockKakao(p.id));
      const n = mockNaver(p.id, p.name);
      if (n) naverMap.set(p.id, n);
    }
  } else {
    const kakaoJob = useUnofficial
      ? mapLimit(candidates, 4, async (p) => kakaoMap.set(p.id, await fetchKakaoReviews(p.id)))
      : Promise.resolve();
    const naverJob = attachNaver(candidates, query.keywords, loc, region, useUnofficial);
    const [, naverRes] = await Promise.all([kakaoJob, naverJob]);
    naverMap = naverRes.map;
    sources.naverReviews = naverRes.status;
    if (useUnofficial) {
      const got = [...kakaoMap.values()].filter(Boolean).length;
      sources.kakaoReviews = got === 0 ? "failed" : got < candidates.length * 0.5 ? "partial" : "ok";
    }
    if (sources.kakaoReviews === "failed") warnings.push("카카오맵 별점을 가져오지 못했어요 (비공식 경로가 막혔을 수 있음).");
    if (sources.naverReviews === "failed") warnings.push("네이버 리뷰 수를 가져오지 못했어요 (비공식 경로가 막혔을 수 있음).");
  }

  // 4) 점수 계산
  let scored: ScoredPlace[] = candidates.map((p) =>
    scorePlace(p, kakaoMap.get(p.id) ?? null, naverMap.get(p.id) ?? null, query, radius, candidates.length),
  );
  scored.sort((a, b) => b.score - a.score);

  // 5) AI 재정렬 + 추천 이유 (상위 15곳 대상)
  if (aiEnabled()) {
    try {
      const top = scored.slice(0, 15);
      const picks = await rerank(query, top);
      if (picks.size > 0) {
        const picked = top
          .filter((p) => picks.has(p.id))
          .map((p) => {
            const pk = picks.get(p.id)!;
            return {
              ...p,
              // 최종 점수 = AI 적합도 60% + 데이터 점수 40%
              score: Math.round(pk.fit * 0.6 + p.score * 0.4),
              reason: pk.reason,
              highlights: pk.highlights.length ? pk.highlights : p.highlights,
              aiRanked: true,
              _order: pk.order,
            };
          })
          .sort((a, b) => a._order - b._order)
          .map(({ _order, ...rest }) => rest);
        scored = picked;
      }
    } catch (e) {
      console.error("[ai] rerank", e);
      sources.ai = "partial";
      warnings.push("AI 추천 이유 생성에 실패해 데이터 점수 순으로 보여드려요.");
    }
  }

  return { query, region, places: scored.slice(0, RESULT_COUNT), sources, warnings };
}

/** 여러 검색어 결과를 합치고, 같은 가게는 matchedKeywords를 합친다 */
function mergeCandidates(list: BasePlace[]): BasePlace[] {
  const byId = new Map<string, BasePlace>();
  for (const p of list) {
    const prev = byId.get(p.id);
    if (!prev) byId.set(p.id, { ...p, matchedKeywords: [...p.matchedKeywords] });
    else {
      prev.searchRank = Math.min(prev.searchRank, p.searchRank);
      for (const k of p.matchedKeywords) if (!prev.matchedKeywords.includes(k)) prev.matchedKeywords.push(k);
    }
  }
  return [...byId.values()];
}

