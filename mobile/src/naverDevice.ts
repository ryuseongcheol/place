import { haversine, nameSimilarity, sameBranch, toNumber } from "./shared";

/**
 * 폰에서 네이버 지도 장소 id 찾기 (비공식 검색).
 * 서버에서 못 찾았을 때 방문자 리뷰 페이지로 바로 가기 위해 쓴다. 실패하면 null.
 */
export interface NaverPlaceInfo {
  id: string;
  visitorReviewCount: number;
  blogReviewCount: number;
  keywords: string[];
  /** 네이버 예약 주소 (예약을 받는 곳만) */
  bookingUrl: string | null;
}

/** 검색 결과 항목 안에서 네이버 예약 주소 찾기 (필드 이름이 시기마다 달라서 값으로 찾는다) */
function findBookingUrl(it: unknown): string | null {
  let found: string | null = null;
  const walk = (v: unknown, d: number) => {
    if (found || d > 4 || !v) return;
    if (typeof v === "string") {
      if (/booking\.naver\.com|m\.booking\.naver|\/booking\b/.test(v) && /^https?:\/\//.test(v)) found = v;
      return;
    }
    if (typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) walk(x, d + 1);
  };
  walk(it, 0);
  return found;
}

const cache = new Map<string, NaverPlaceInfo | null>();
let consecutiveFailures = 0;
let everSucceeded = false;

/** 폰에서 네이버 검색이 막힌 것으로 보이는지 (수집 때 계속 시도하지 않게) */
export function naverDeviceBlocked() {
  return !everSucceeded && consecutiveFailures >= 8;
}

export async function resolveNaverPlaceId(p: { id: string; name: string; lat: number; lng: number }): Promise<string | null> {
  return (await lookupNaverPlace(p))?.id ?? null;
}

/** 네이버 장소 id + 방문자/블로그 리뷰 수 + 키워드 리뷰 */
export async function lookupNaverPlace(p: { id: string; name: string; lat: number; lng: number }): Promise<NaverPlaceInfo | null> {
  if (cache.has(p.id)) return cache.get(p.id) ?? null;
  const params = new URLSearchParams({ query: p.name, type: "all", searchCoord: `${p.lng};${p.lat}`, boundary: "" });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`https://map.naver.com/p/api/search/allSearch?${params}`, {
      headers: {
        Accept: "application/json, text/plain, */*",
        "Accept-Language": "ko-KR,ko;q=0.9",
        Referer: `https://map.naver.com/p/search/${encodeURIComponent(p.name)}`,
        "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as { result?: { place?: { list?: Array<Record<string, unknown>> } } };
    const list = json.result?.place?.list ?? [];
    let best: { info: NaverPlaceInfo; score: number } | null = null;
    for (const it of list) {
      const lat = toNumber(it.y);
      const lng = toNumber(it.x);
      const name = typeof it.name === "string" ? it.name : "";
      if (lat === null || lng === null || !it.id) continue;
      // 근처 다른 지점에 잘못 붙지 않게 (서버 matchNaver 와 같은 기준)
      const dist = haversine(p, { lat, lng });
      const sim = nameSimilarity(p.name, name);
      if (dist > (sim >= 0.95 ? 150 : 100) || sim < 0.7 || !sameBranch(p.name, name)) continue;
      const score = sim - dist / 1000;
      if (!best || score > best.score) {
        const micro = Array.isArray(it.microReview) ? (it.microReview as unknown[]).filter((x): x is string => typeof x === "string") : [];
        best = {
          score,
          info: {
            id: String(it.id),
            visitorReviewCount: toNumber(it.placeReviewCount ?? it.visitorReviewCount) ?? 0,
            blogReviewCount: toNumber(it.reviewCount ?? it.blogCafeReviewCount) ?? 0,
            keywords: micro.slice(0, 8),
            bookingUrl: findBookingUrl(it),
          },
        };
      }
    }
    consecutiveFailures = 0;
    everSucceeded = true;
    cache.set(p.id, best?.info ?? null);
    return best?.info ?? null;
  } catch {
    consecutiveFailures++;
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function naverVisitorReviewUrl(naverId: string) {
  return `https://m.place.naver.com/restaurant/${naverId}/review/visitor`;
}

/** 장소 id를 못 찾았을 때: 네이버 지도 모바일 검색 (웹뷰에서 가게를 누르면 리뷰 탭으로 보낸다) */
export function naverMapSearchUrl(name: string, area?: string | null) {
  return `https://m.map.naver.com/search2/search.naver?query=${encodeURIComponent(`${area ?? ""} ${name}`.trim())}`;
}

/** 네이버 예약 페이지: 예약 주소를 알면 그 주소, 아니면 플레이스의 예약 탭 */
export function naverBookingUrl(naverId: string, bookingUrl?: string | null) {
  return bookingUrl ?? `https://m.place.naver.com/restaurant/${naverId}/booking`;
}
