import type { BasePlace, KakaoReviewInfo, NaverReviewInfo, ScoredPlace, ThemeQuery } from "./types";

/** 리뷰 수가 적은 높은 별점을 보정하기 위한 베이지안 평균 */
const PRIOR_RATING = 3.6;
const PRIOR_WEIGHT = 8;

export function bayesRating(r: number | null, n: number): number | null {
  if (r === null) return null;
  return (n * r + PRIOR_WEIGHT * PRIOR_RATING) / (n + PRIOR_WEIGHT);
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function textHits(haystack: string, needles: string[]): number {
  const h = haystack.toLowerCase();
  return needles.filter((n) => n && h.includes(n.toLowerCase())).length;
}

export function scorePlace(
  p: BasePlace,
  kakao: KakaoReviewInfo | null,
  naver: NaverReviewInfo | null,
  q: ThemeQuery,
  radius: number,
  totalCandidates: number,
): ScoredPlace {
  // 1) 평점: 카카오 별점(베이지안 보정). 네이버 별점이 있으면 평균. 정보가 없으면 중립 0.45
  const ratings: number[] = [];
  const kb = kakao ? bayesRating(kakao.rating, kakao.ratingCount) : null;
  if (kb !== null) ratings.push(kb);
  if (naver?.rating) ratings.push(bayesRating(naver.rating, naver.visitorReviewCount)!);
  const avgRating = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  const rating = avgRating === null ? 0.45 : clamp01((avgRating - 2.8) / 2);

  // 2) 인기도: 리뷰 수의 로그 스케일 (네이버 방문자 리뷰가 가장 많으므로 가중)
  const volume =
    (kakao?.reviewCount ?? 0) + (kakao?.blogReviewCount ?? 0) * 0.5 + (naver?.visitorReviewCount ?? 0) + (naver?.blogReviewCount ?? 0) * 0.5;
  const popularity = clamp01(Math.log10(1 + volume) / 3.5);

  // 3) 주제 관련도: 검색 정확도 순위 + 여러 검색어에 걸린 횟수 + 리뷰/카테고리 키워드 일치 - 회피 키워드
  const text = [p.name, p.category, ...(kakao?.snippets ?? []), ...(kakao?.tags ?? []), ...(naver?.keywords ?? [])].join(" ");
  const rankScore = 1 - p.searchRank / Math.max(1, totalCandidates);
  const multiHit = Math.min(1, (p.matchedKeywords.length - 1) / 2);
  const boostHits = Math.min(1, textHits(text, q.boost) / 2);
  const avoidHits = textHits(`${p.name} ${p.category}`, q.avoid);
  const relevance = clamp01(0.45 * rankScore + 0.25 * multiHit + 0.3 * boostHits - 0.5 * avoidHits);

  // 4) 거리
  const distance = clamp01(1 - p.distance / Math.max(radius, 1));

  const w = q.weights;
  const wsum = w.rating + w.popularity + w.relevance + w.distance || 1;
  const score = (100 * (w.rating * rating + w.popularity * popularity + w.relevance * relevance + w.distance * distance)) / wsum;

  return {
    ...p,
    kakao,
    naver,
    score: Math.round(score),
    scoreBreakdown: {
      rating: Math.round(rating * 100),
      popularity: Math.round(popularity * 100),
      relevance: Math.round(relevance * 100),
      distance: Math.round(distance * 100),
    },
    reason: heuristicReason(p, kakao, naver, q),
    highlights: (kakao?.tags ?? []).concat(naver?.keywords ?? []).slice(0, 4),
    aiRanked: false,
  };
}

function heuristicReason(p: BasePlace, kakao: KakaoReviewInfo | null, naver: NaverReviewInfo | null, q: ThemeQuery): string {
  const parts: string[] = [];
  const cat = p.category.split(">").pop()?.trim();
  if (cat) parts.push(cat);
  if (kakao?.rating) parts.push(`카카오 ★${kakao.rating.toFixed(1)} (${kakao.ratingCount}명)`);
  if (naver?.visitorReviewCount) parts.push(`네이버 방문자 리뷰 ${naver.visitorReviewCount.toLocaleString()}개`);
  parts.push(`${p.distance}m`);
  const kw = p.matchedKeywords.slice(0, 2).join(", ");
  return `'${kw}' 검색에 잡힌 ${parts.join(" · ")}. ${q.summary}에 맞을 가능성이 높아요.`;
}
