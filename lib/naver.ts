import { formatDate, normalizeImageUrl, stripTags } from "./kakaoDetail";
import type { Budget } from "./budget";
import type { BasePlace, BlogReview, LatLng, NaverReviewInfo } from "./types";
import { BROWSER_UA, TTLCache, collectStrings, deepFind, fetchWithTimeout, haversine, nameSimilarity, normalizeName, toNumber } from "./util";

/**
 * [공식] 네이버 검색 API 설정.
 * 2026-07-31부터 네이버 개발자센터 신규 발급이 끝나고 네이버 클라우드의 NAVER API HUB로 옮겨갔다.
 * - API HUB (우선): NAVER_HUB_CLIENT_ID / NAVER_HUB_CLIENT_SECRET
 *   https://naverapihub.apigw.ntruss.com/search/v1/{blog|image|local}, X-NCP-APIGW-API-KEY-ID / X-NCP-APIGW-API-KEY 헤더
 * - 개발자센터 (구, 기존 발급 키만): NAVER_CLIENT_ID / NAVER_CLIENT_SECRET
 *   https://openapi.naver.com/v1/search/{blog.json|image|local.json}, X-Naver-Client-Id / X-Naver-Client-Secret 헤더
 * 요청 파라미터와 응답 형식은 같다.
 */
type SearchKind = "blog" | "image" | "local";

function naverSearchConfig(): { url: (kind: SearchKind) => string; headers: Record<string, string> } | null {
  const hubId = process.env.NAVER_HUB_CLIENT_ID;
  const hubSecret = process.env.NAVER_HUB_CLIENT_SECRET;
  if (hubId && hubSecret) {
    return {
      url: (kind) => `https://naverapihub.apigw.ntruss.com/search/v1/${kind}`,
      headers: { "X-NCP-APIGW-API-KEY-ID": hubId, "X-NCP-APIGW-API-KEY": hubSecret },
    };
  }
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (id && secret) {
    return {
      url: (kind) => `https://openapi.naver.com/v1/search/${kind === "image" ? "image" : `${kind}.json`}`,
      headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
    };
  }
  return null;
}

export function naverSearchEnabled() {
  return naverSearchConfig() !== null;
}

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
export async function naverMapSearch(query: string, loc: LatLng, budget?: Budget): Promise<NaverCandidate[]> {
  const key = `${query}|${loc.lat.toFixed(3)}|${loc.lng.toFixed(3)}`;
  const cached = mapSearchCache.get(key);
  if (cached) return cached;
  if (budget && !budget.take()) return [];

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
export async function naverOfficialLocal(query: string, budget?: Budget): Promise<NaverCandidate[]> {
  const cfg = naverSearchConfig();
  if (!cfg) return [];
  const cached = officialCache.get(query);
  if (cached) return cached;
  if (budget && !budget.take()) return [];
  try {
    const params = new URLSearchParams({ query, display: "5", sort: "random" });
    const res = await fetchWithTimeout(`${cfg.url("local")}?${params}`, { headers: cfg.headers });
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
  opts: { budget?: Budget; keywordSearches: number; individual: number } = { keywordSearches: 4, individual: 8 },
): Promise<{ map: Map<string, NaverReviewInfo>; status: "ok" | "partial" | "failed" | "disabled" }> {
  const result = new Map<string, NaverReviewInfo>();
  let unofficialWorked = false;

  if (useUnofficial) {
    const pools = await Promise.all(keywords.slice(0, opts.keywordSearches).map((k) => naverMapSearch(k, loc, opts.budget)));
    const pool = pools.flat();
    unofficialWorked = pool.length > 0;
    for (const p of places) {
      const m = matchNaver(p, pool);
      if (m) result.set(p.id, m);
    }
    // 상위 미매칭 장소 개별 검색 (최대 8건)
    if (unofficialWorked) {
      const missing = places.filter((p) => !result.has(p.id)).slice(0, opts.individual);
      await Promise.all(
        missing.map(async (p) => {
          const m = matchNaver(p, await naverMapSearch(p.name, p, opts.budget));
          if (m) result.set(p.id, m);
        }),
      );
    }
  }

  if (!unofficialWorked) {
    const missing = places.filter((p) => !result.has(p.id)).slice(0, opts.individual + opts.keywordSearches);
    await Promise.all(
      missing.map(async (p) => {
        const q = region ? `${region.split(" ").pop()} ${p.name}` : p.name;
        const m = matchNaver(p, await naverOfficialLocal(q, opts.budget));
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

// ---------- 식당 상세용 (공식 검색 API) ----------

const blogCache = new TTLCache<{ items: BlogReview[]; total: number } | null>(6 * 60 * 60 * 1000, 500);
const imageCache = new TTLCache<string[] | null>(6 * 60 * 60 * 1000, 500);


/** 가게 이름의 핵심 부분 (지점명/공백 제거) — 블로그 글이 정말 이 가게 얘기인지 거르는 데 쓴다 */
function coreName(name: string) {
  return normalizeName(name.replace(/\s*\S+점$/, ""));
}

/**
 * [공식] 네이버 블로그 검색. "동네 + 가게명"으로 검색하고, 제목/본문에 가게명이 들어간 글만 남긴다.
 */
export async function naverBlogSearch(name: string, region: string | null, budget?: Budget): Promise<{ items: BlogReview[]; total: number } | null> {
  const cfg = naverSearchConfig();
  if (!cfg) return null;
  const dong = region?.split(" ").pop() ?? "";
  const query = `${dong} ${name}`.trim();
  const cached = blogCache.get(query);
  if (cached !== undefined) return cached;
  if (budget && !budget.take()) return null;
  try {
    const params = new URLSearchParams({ query, display: "30", sort: "sim" });
    const res = await fetchWithTimeout(`${cfg.url("blog")}?${params}`, { headers: cfg.headers });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as {
      total: number;
      items: Array<{ title: string; link: string; description: string; bloggername: string; postdate: string }>;
    };
    // 블로그 글이 이 가게 얘기인지: 전체 이름 또는 첫 단어(2글자 이상)가 제목/본문에 있어야 한다
    const core = coreName(name);
    const firstWord = normalizeName(name.split(/\s+/)[0] ?? "");
    const mentions = (text: string) => {
      const t = normalizeName(text);
      return !core || t.includes(core) || (firstWord.length >= 2 && t.includes(firstWord));
    };
    const items = data.items
      .map(
        (it): BlogReview => ({
          title: stripTags(it.title),
          snippet: stripTags(it.description).slice(0, 200),
          url: it.link,
          blogger: it.bloggername || null,
          date: formatDate(it.postdate),
          thumbnail: null,
          source: "naver",
        }),
      )
      .filter((b) => mentions(`${b.title} ${b.snippet}`))
      .slice(0, 15);
    const out = { items, total: data.total };
    blogCache.set(query, out);
    return out;
  } catch {
    blogCache.set(query, null);
    return null;
  }
}

/** [공식] 네이버 이미지 검색 — 카카오 사진이 없을 때 대체 사진으로 쓴다 (네이버 검색 썸네일 주소) */
export async function naverImageSearch(name: string, region: string | null, budget?: Budget): Promise<string[] | null> {
  const cfg = naverSearchConfig();
  if (!cfg) return null;
  const dong = region?.split(" ").pop() ?? "";
  const query = `${dong} ${name}`.trim();
  const cached = imageCache.get(query);
  if (cached !== undefined) return cached;
  if (budget && !budget.take()) return null;
  try {
    const params = new URLSearchParams({ query, display: "12", sort: "sim", filter: "medium" });
    const res = await fetchWithTimeout(`${cfg.url("image")}?${params}`, { headers: cfg.headers });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { items: Array<{ thumbnail: string; link: string }> };
    const out = data.items.map((i) => normalizeImageUrl(i.thumbnail)).filter((u): u is string => Boolean(u));
    imageCache.set(query, out);
    return out;
  } catch {
    imageCache.set(query, null);
    return null;
  }
}

/** 네이버 플레이스 모바일 페이지 링크 (리뷰는 웹뷰로 이 페이지를 보여준다) */
export function naverPlaceLinks(naverId: string | null, name: string, region: string | null) {
  if (naverId) {
    const base = `https://m.place.naver.com/restaurant/${naverId}`;
    return { place: `${base}/home`, visitor: `${base}/review/visitor`, blog: `${base}/review/ugc` };
  }
  const q = encodeURIComponent(`${region?.split(" ").pop() ?? ""} ${name}`.trim());
  const search = `https://m.search.naver.com/search.naver?query=${q}`;
  return { place: `https://m.map.naver.com/search2/search.naver?query=${q}`, visitor: search, blog: `https://m.search.naver.com/search.naver?where=m_blog&query=${q}` };
}
