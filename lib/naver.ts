import type { BasePlace, LatLng, NaverReviewInfo } from "./types";
import { BROWSER_UA, TTLCache, collectStrings, deepFind, fetchWithTimeout, haversine, nameSimilarity, toNumber } from "./util";

/**
 * 네이버 지도 장소 후보 (비공식 검색 or 공식 검색 API에서 얻음)
 */
interface NaverCandidate {
  id: string | null;
  name: string;
  lat: number;
  lng: number;
  visitorReviewCount: number;
  blogReviewCount: number;
  rating: number | null;
  keywords: string[];
}

const mapSearchCache = new TTLCache<NaverCandidate[]>(30 * 60 * 1000);
const officialCache = new TTLCache<NaverCandidate[]>(30 * 60 * 1000);

/**
 * [비공식] 네이버 지도 웹이 사용하는 통합 검색 엔드포인트.
 * 한 번 호출로 주변 장소 여러 개의 리뷰 수를 받을 수 있어 장소마다 호출하지 않아도 된다.
 * 응답 구조/차단 정책이 수시로 바뀌므로 실패하면 빈 배열을 돌려준다.
 */
export async function naverMapSearch(query: string, loc: LatLng): Promise<NaverCandidate[]> {
  const key = `${query}|${loc.lat.toFixed(3)}|${loc.lng.toFixed(3)}`;
  const cached = mapSearchCache.get(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    query,
    type: "all",
    searchCoord: `${loc.lng};${loc.lat}`,
    boundary: "",
  });
  try {
    const res = await fetchWithTimeout(`https://map.naver.com/p/api/search/allSearch?${params}`, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "ko-KR,ko;q=0.9",
        Referer: "https://map.naver.com/p/search/" + encodeURIComponent(query),
      },
    });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as unknown;
    const list = deepFind(json, ["list"]) as unknown;
    const items = Array.isArray(list) ? list : [];
    const out: NaverCandidate[] = items
      .map((raw): NaverCandidate | null => {
        const it = raw as Record<string, unknown>;
        const lat = toNumber(it.y);
        const lng = toNumber(it.x);
        const name = typeof it.name === "string" ? it.name : null;
        if (!name || lat === null || lng === null) return null;
        const micro = Array.isArray(it.microReview) ? (it.microReview as unknown[]).filter((s): s is string => typeof s === "string") : [];
        return {
          id: it.id != null ? String(it.id) : null,
          name,
          lat,
          lng,
          // 필드명이 시기별로 다름: placeReviewCount/visitorReviewCount = 방문자 리뷰, reviewCount = 블로그 리뷰
          visitorReviewCount: toNumber(it.placeReviewCount ?? it.visitorReviewCount) ?? 0,
          blogReviewCount: toNumber(it.reviewCount ?? it.blogCafeReviewCount) ?? 0,
          rating: toNumber(it.visitorReviewScore ?? it.reviewScore),
          keywords: [...micro, ...collectStrings(it, ["keyword"], 5)].slice(0, 6),
        };
      })
      .filter((x): x is NaverCandidate => x !== null);
    mapSearchCache.set(key, out);
    return out;
  } catch {
    mapSearchCache.set(key, []);
    return [];
  }
}

/**
 * [공식] 네이버 검색 API(지역). 최대 5건, 리뷰 정보는 없음.
 * 비공식 검색이 막혔을 때 최소한 네이버 지도 링크를 정확히 걸기 위한 보조 수단.
 */
export async function naverOfficialLocal(query: string): Promise<NaverCandidate[]> {
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return [];
  const cached = officialCache.get(query);
  if (cached) return cached;
  try {
    const params = new URLSearchParams({ query, display: "5", sort: "random" });
    const res = await fetchWithTimeout(`https://openapi.naver.com/v1/search/local.json?${params}`, {
      headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items: Array<{ title: string; mapx: string; mapy: string }> };
    const out = data.items.map((it) => ({
      id: null,
      name: it.title.replace(/<[^>]+>/g, ""),
      // 2023년 이후 mapx/mapy는 WGS84 * 1e7
      lng: Number(it.mapx) / 1e7,
      lat: Number(it.mapy) / 1e7,
      visitorReviewCount: 0,
      blogReviewCount: 0,
      rating: null,
      keywords: [],
    }));
    officialCache.set(query, out);
    return out;
  } catch {
    return [];
  }
}

function naverPlaceUrl(place: BasePlace, naverId: string | null) {
  return naverId
    ? `https://map.naver.com/p/entry/place/${naverId}`
    : `https://map.naver.com/p/search/${encodeURIComponent(place.name)}`;
}

/** 카카오 장소와 네이버 후보를 이름 유사도 + 거리로 매칭 */
export function matchNaver(place: BasePlace, candidates: NaverCandidate[]): NaverReviewInfo | null {
  let best: { c: NaverCandidate; score: number } | null = null;
  for (const c of candidates) {
    const dist = haversine(place, c);
    if (dist > 150) continue;
    const sim = nameSimilarity(place.name, c.name);
    if (sim < 0.6) continue;
    const score = sim - dist / 1000;
    if (!best || score > best.score) best = { c, score };
  }
  if (!best) return null;
  const c = best.c;
  return {
    naverId: c.id,
    visitorReviewCount: c.visitorReviewCount,
    blogReviewCount: c.blogReviewCount,
    rating: c.rating,
    keywords: c.keywords,
    naverUrl: naverPlaceUrl(place, c.id),
  };
}

/**
 * 장소 목록에 네이버 리뷰 정보를 붙인다.
 * 1) 검색어별 비공식 지도 검색 (한 번에 여러 장소)
 * 2) 매칭 안 된 상위 장소는 가게 이름으로 개별 검색 (호출 수 제한)
 * 3) 그래도 실패하면 공식 검색 API로 링크만이라도 확보
 */
export async function attachNaver(
  places: BasePlace[],
  keywords: string[],
  loc: LatLng,
  region: string | null,
  useUnofficial: boolean,
): Promise<{ map: Map<string, NaverReviewInfo>; status: "ok" | "partial" | "failed" | "disabled" }> {
  const result = new Map<string, NaverReviewInfo>();
  let unofficialWorked = false;

  if (useUnofficial) {
    const pools = await Promise.all(keywords.map((k) => naverMapSearch(k, loc)));
    const pool = pools.flat();
    unofficialWorked = pool.length > 0;
    for (const p of places) {
      const m = matchNaver(p, pool);
      if (m) result.set(p.id, m);
    }
    // 상위 미매칭 장소 개별 검색 (최대 8건)
    if (unofficialWorked) {
      const missing = places.filter((p) => !result.has(p.id)).slice(0, 8);
      await Promise.all(
        missing.map(async (p) => {
          const m = matchNaver(p, await naverMapSearch(p.name, p));
          if (m) result.set(p.id, m);
        }),
      );
    }
  }

  if (!unofficialWorked) {
    const missing = places.filter((p) => !result.has(p.id)).slice(0, 10);
    await Promise.all(
      missing.map(async (p) => {
        const q = region ? `${region.split(" ").pop()} ${p.name}` : p.name;
        const m = matchNaver(p, await naverOfficialLocal(q));
        if (m) result.set(p.id, m);
      }),
    );
  }

  const status = !useUnofficial ? "disabled" : !unofficialWorked ? "failed" : result.size >= places.length * 0.5 ? "ok" : "partial";
  return { map: result, status };
}

export function naverSearchUrl(name: string) {
  return `https://map.naver.com/p/search/${encodeURIComponent(name)}`;
}
